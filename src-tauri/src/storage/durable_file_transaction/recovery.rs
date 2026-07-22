//! DurableFileTransaction 启动恢复与显式 restore。
//!
//! @author kongweiguang

use super::*;

/// 恢复全部 pending journal；调用方必须持有 FileStore 锁。
pub(crate) fn recover_pending_locked(store: &FileStore) -> FileStoreResult<()> {
    let pending_paths = list_pending_journals(store)?;
    let mut manifest = store.read_storage_manifest_locked()?;

    for pending_path in pending_paths {
        let mut journal = read_journal(&pending_path)?;
        validate_journal(store, &pending_path, &journal)?;
        let completed_at = recovery_timestamp();
        match journal.phase {
            JournalPhase::Preparing | JournalPhase::Prepared => {
                // 这两个阶段从未触碰目标文件，恢复只收口 journal/manifest。
                journal.phase = JournalPhase::RolledBack;
                write_pending_journal(store, &journal)?;
                mark_manifest_repaired_if_present(&mut manifest, &journal.id, &completed_at);
                store.write_storage_manifest_locked(&manifest)?;
                finalize_terminal_journal(store, &journal)?;
            }
            JournalPhase::Applying => {
                journal.phase = JournalPhase::RollingBack;
                write_pending_journal(store, &journal)?;
                recover_rollback(store, &mut manifest, &mut journal, &completed_at)?;
            }
            JournalPhase::RollingBack => {
                recover_rollback(store, &mut manifest, &mut journal, &completed_at)?;
            }
            JournalPhase::Committed => {
                if manifest.change_set(&journal.id).is_none() {
                    return Err(recovery_error(
                        &journal.id,
                        "committed journal has no matching manifest entry",
                    ));
                }
                manifest.mark_applied(&journal.id, &completed_at);
                store.write_storage_manifest_locked(&manifest)?;
                finalize_terminal_journal(store, &journal)?;
            }
            JournalPhase::RolledBack => {
                mark_manifest_repaired_if_present(&mut manifest, &journal.id, &completed_at);
                store.write_storage_manifest_locked(&manifest)?;
                finalize_terminal_journal(store, &journal)?;
            }
        }
    }

    let manifest = store.read_storage_manifest_locked()?;
    if let Some(active_id) = manifest.active_change_set_id {
        return Err(recovery_error(
            &active_id,
            "active change-set has no recoverable pending journal",
        ));
    }
    Ok(())
}

/// 恢复指定已提交 change-set；只接受带显式 original state 的当前 journal 格式。
pub(crate) fn restore_change_set_locked(
    store: &FileStore,
    id: &str,
    timestamp: &str,
) -> FileStoreResult<StorageManifest> {
    validate_change_set_id(id)?;
    recover_pending_locked(store)?;
    let mut manifest = store.read_storage_manifest_locked()?;
    let change_set = manifest
        .change_set(id)
        .cloned()
        .ok_or_else(|| FileStoreError::InvalidPath(format!("unknown change set: {id}")))?;

    let rolled_back_path = terminal_journal_path(store, id, JournalPhase::RolledBack)?;
    if rolled_back_path.is_file() || change_set.status == ChangeSetStatus::Repaired {
        manifest.mark_repaired(id, timestamp);
        store.write_storage_manifest_locked(&manifest)?;
        return Ok(manifest);
    }

    let committed_path = terminal_journal_path(store, id, JournalPhase::Committed)?;
    if committed_path.is_file() {
        let mut journal = read_journal(&committed_path)?;
        validate_journal(store, &committed_path, &journal)?;
        write_pending_journal(store, &journal)?;
        durable_remove_file(&committed_path)?;
        journal.phase = JournalPhase::RollingBack;
        write_pending_journal(store, &journal)?;
        rollback_entries(store, &journal)?;
        journal.phase = JournalPhase::RolledBack;
        write_pending_journal(store, &journal)?;
        manifest.mark_repaired(id, timestamp);
        store.write_storage_manifest_locked(&manifest)?;
        finalize_terminal_journal(store, &journal)?;
        return Ok(manifest);
    }

    Err(recovery_error(
        id,
        "committed transaction journal is missing; legacy manifest-only restore is unsupported",
    ))
}

fn recover_rollback(
    store: &FileStore,
    manifest: &mut StorageManifest,
    journal: &mut TransactionJournal,
    completed_at: &str,
) -> FileStoreResult<()> {
    if let Err(error) = rollback_entries(store, journal) {
        manifest.mark_failed(
            &journal.id,
            completed_at,
            format!("restart recovery failed: {error}"),
        );
        let _ = store.write_storage_manifest_locked(manifest);
        return Err(recovery_error(&journal.id, error.to_string()));
    }
    journal.phase = JournalPhase::RolledBack;
    finish_rollback_metadata(store, manifest, journal, completed_at)
}

pub(super) fn finish_rollback_metadata(
    store: &FileStore,
    manifest: &mut StorageManifest,
    journal: &TransactionJournal,
    completed_at: &str,
) -> FileStoreResult<()> {
    write_pending_journal(store, journal)?;
    mark_manifest_repaired_if_present(manifest, &journal.id, completed_at);
    store.write_storage_manifest_locked(manifest)?;
    finalize_terminal_journal(store, journal)
}

pub(super) fn rollback_entries(
    store: &FileStore,
    journal: &TransactionJournal,
) -> FileStoreResult<()> {
    validate_prepared_entries(journal)?;
    for entry in &journal.entries {
        let target_path = store.path_for(&entry.relative_path)?;
        let target_contents = match fs::read(&target_path) {
            Ok(contents) => Some(contents),
            Err(error) if is_missing_path_error(&error) => None,
            Err(error) => return Err(error.into()),
        };

        if entry.original_exists {
            let backup_relative = entry.backup_path.as_deref().ok_or_else(|| {
                recovery_error(&journal.id, "present original has no backup path")
            })?;
            let backup_path = store.path_for(backup_relative)?;
            let backup_contents = fs::read(&backup_path).map_err(|error| {
                recovery_error(
                    &journal.id,
                    format!(
                        "cannot read declared backup {}: {error}",
                        backup_path.display()
                    ),
                )
            })?;
            let original_digest = entry
                .original_sha256
                .as_deref()
                .ok_or_else(|| recovery_error(&journal.id, "present original has no digest"))?;
            if content_sha256(&backup_contents) != original_digest {
                return Err(recovery_error(
                    &journal.id,
                    "declared backup digest mismatch",
                ));
            }

            match target_contents {
                None => {
                    store.atomic_write_locked(&entry.relative_path, &backup_contents)?;
                }
                Some(contents) => {
                    let target_digest = content_sha256(&contents);
                    if target_digest == original_digest {
                        continue;
                    }
                    if target_matches_intended_state(entry, &target_digest) {
                        store.atomic_write_locked(&entry.relative_path, &backup_contents)?;
                    } else {
                        return Err(FileStoreError::TransactionConflict(PathBuf::from(
                            &entry.relative_path,
                        )));
                    }
                }
            }
        } else {
            match (entry.action, target_contents) {
                (_, None) => {}
                (JournalAction::Write, Some(contents)) => {
                    let intended = entry.intended_sha256.as_deref().ok_or_else(|| {
                        recovery_error(&journal.id, "write action has no intended digest")
                    })?;
                    if content_sha256(&contents) != intended {
                        return Err(FileStoreError::TransactionConflict(PathBuf::from(
                            &entry.relative_path,
                        )));
                    }
                    store.remove_file_locked(&entry.relative_path)?;
                }
                (JournalAction::Delete, Some(_)) => {
                    return Err(FileStoreError::TransactionConflict(PathBuf::from(
                        &entry.relative_path,
                    )))
                }
            }
        }
    }
    Ok(())
}

fn target_matches_intended_state(entry: &TransactionJournalEntry, target_digest: &str) -> bool {
    match entry.action {
        JournalAction::Write => entry.intended_sha256.as_deref() == Some(target_digest),
        JournalAction::Delete => false,
    }
}

fn mark_manifest_repaired_if_present(manifest: &mut StorageManifest, id: &str, completed_at: &str) {
    if manifest.change_set(id).is_some() {
        manifest.mark_repaired(id, completed_at);
    }
}

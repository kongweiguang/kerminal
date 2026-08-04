// @author kongweiguang

use super::*;

pub(super) fn char_prefix(value: &str, count: usize) -> String {
    value.chars().take(count).collect()
}

pub(super) fn is_cacheable_remote_entry(entry: &SftpEntry) -> bool {
    !entry.name.is_empty()
        && entry.name != "."
        && entry.name != ".."
        && !contains_control_character(&entry.name)
}

pub(super) fn compare_sftp_entries(left: &SftpEntry, right: &SftpEntry) -> std::cmp::Ordering {
    sftp_entry_sort_rank(&left.kind)
        .cmp(&sftp_entry_sort_rank(&right.kind))
        .then_with(|| left.name.cmp(&right.name))
}

pub(super) fn compare_git_ref_entries(
    left: &GitRefEntry,
    right: &GitRefEntry,
) -> std::cmp::Ordering {
    git_ref_sort_rank(left.kind)
        .cmp(&git_ref_sort_rank(right.kind))
        .then_with(|| left.name.cmp(&right.name))
}

pub(super) fn git_ref_sort_rank(kind: GitRefKind) -> u8 {
    match kind {
        GitRefKind::Branch => 0,
        GitRefKind::Remote => 1,
        GitRefKind::RemoteBranch => 2,
        GitRefKind::Tag => 3,
    }
}

pub(super) fn sftp_entry_sort_rank(kind: &SftpEntryKind) -> u8 {
    match kind {
        SftpEntryKind::Directory => 0,
        SftpEntryKind::Symlink => 1,
        SftpEntryKind::File => 2,
        SftpEntryKind::Other => 3,
    }
}

pub(super) fn sftp_entry_kind_name(kind: SftpEntryKind) -> &'static str {
    match kind {
        SftpEntryKind::File => "file",
        SftpEntryKind::Directory => "directory",
        SftpEntryKind::Symlink => "symlink",
        SftpEntryKind::Other => "other",
    }
}

pub(super) fn prune_remote_path_cache(
    cache: &mut HashMap<RemotePathCacheKey, RemotePathCacheEntry>,
    now: SystemTime,
) {
    cache.retain(|_, entry| provider_cache_is_retained(entry.expires_at, now));
}

pub(super) fn prune_remote_command_cache(
    cache: &mut HashMap<String, RemoteCommandCacheEntry>,
    now: SystemTime,
) {
    cache.retain(|_, entry| provider_cache_is_retained(entry.expires_at, now));
}

pub(super) fn prune_remote_history_cache(
    cache: &mut HashMap<String, RemoteHistoryCacheEntry>,
    now: SystemTime,
) {
    cache.retain(|_, entry| provider_cache_is_retained(entry.expires_at, now));
}

pub(super) fn prune_git_cache(cache: &mut HashMap<GitCacheKey, GitCacheEntry>, now: SystemTime) {
    cache.retain(|_, entry| provider_cache_is_retained(entry.expires_at, now));
}

pub(super) fn provider_cache_is_stale(expires_at: SystemTime, now: SystemTime) -> bool {
    expires_at <= now
}

pub(super) fn provider_cache_retention_cutoff(now: SystemTime) -> SystemTime {
    now.checked_sub(Duration::from_secs(REMOTE_PROVIDER_STALE_RETENTION_SECS))
        .unwrap_or(UNIX_EPOCH)
}

fn provider_cache_is_retained(expires_at: SystemTime, now: SystemTime) -> bool {
    expires_at > provider_cache_retention_cutoff(now)
}

pub(super) fn insert_provider_cache_freshness_metadata(
    metadata: &mut BTreeMap<String, String>,
    expires_at: SystemTime,
    now: SystemTime,
) {
    metadata.insert(
        "cacheState".to_owned(),
        if provider_cache_is_stale(expires_at, now) {
            "stale"
        } else {
            "fresh"
        }
        .to_owned(),
    );
}

pub(super) fn remove_oldest_remote_path_cache_entry(
    cache: &mut HashMap<RemotePathCacheKey, RemotePathCacheEntry>,
) {
    let Some(oldest_key) = cache
        .iter()
        .min_by_key(|(_, entry)| unix_time_millis(entry.cached_at))
        .map(|(key, _)| key.clone())
    else {
        return;
    };
    cache.remove(&oldest_key);
}

pub(super) fn remove_oldest_git_cache_entry(cache: &mut HashMap<GitCacheKey, GitCacheEntry>) {
    let Some(oldest_key) = cache
        .iter()
        .min_by_key(|(_, entry)| unix_time_millis(entry.cached_at))
        .map(|(key, _)| key.clone())
    else {
        return;
    };
    cache.remove(&oldest_key);
}

pub(super) fn unix_time_millis(time: SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub(super) fn elapsed_millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

pub(super) fn unix_time_millis_i64(time: SystemTime) -> i64 {
    i64::try_from(unix_time_millis(time)).unwrap_or(i64::MAX)
}

pub(super) fn normalize_retention_days(value: Option<u32>, fallback: u32) -> u32 {
    value
        .unwrap_or(fallback)
        .clamp(1, MAX_DIAGNOSTIC_RETENTION_DAYS)
}

pub(super) fn retention_cutoff_unix_ms(now_unix_ms: i64, retention_days: u32) -> i64 {
    let retention_ms = i64::from(retention_days).saturating_mul(24 * 60 * 60 * 1_000);
    now_unix_ms.saturating_sub(retention_ms)
}

pub(super) fn system_time_from_unix_millis(value: i64) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(value.max(0) as u64)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn upsert_provider_cache(
    storage: &CommandSqliteStore,
    provider: SuggestionProviderKind,
    host_id: &str,
    scope_key: &str,
    repo_root: Option<&str>,
    payload_json: String,
    cached_at: SystemTime,
    expires_at: SystemTime,
    ttl_seconds: u64,
) -> AppResult<()> {
    storage.upsert_command_suggestion_provider_cache(&CommandSuggestionProviderCacheWrite {
        cached_at_unix_ms: unix_time_millis_i64(cached_at),
        expires_at_unix_ms: unix_time_millis_i64(expires_at),
        host_id: host_id.to_owned(),
        payload_json,
        provider,
        repo_root: repo_root.map(ToOwned::to_owned),
        scope_key: scope_key.to_owned(),
        ttl_seconds,
    })
}

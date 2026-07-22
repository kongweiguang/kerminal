//! Command-domain SQLite connection.
//!
//! @author kongweiguang

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use rusqlite::Connection;

use crate::{
    error::{AppError, AppResult},
    paths::KerminalPaths,
    storage::command_migrations,
};

/// Dedicated SQLite store for command history and command suggestions.
#[derive(Debug)]
pub struct CommandSqliteStore {
    database_file: PathBuf,
    conn: Mutex<Connection>,
}

impl CommandSqliteStore {
    /// Opens and initializes the command-domain database.
    pub fn open(paths: &KerminalPaths) -> AppResult<Self> {
        paths.ensure_directories()?;

        let mut conn = Connection::open(&paths.command_database_file)?;
        configure_connection(&conn)?;
        command_migrations::migrate(&mut conn)?;

        Ok(Self {
            database_file: paths.command_database_file.clone(),
            conn: Mutex::new(conn),
        })
    }

    /// Returns the command database file path.
    pub fn database_file(&self) -> &Path {
        &self.database_file
    }

    /// Reads the command schema version.
    pub fn schema_version(&self) -> AppResult<u32> {
        self.with_connection(command_migrations::schema_version)
    }

    pub(crate) fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> AppResult<T>,
    ) -> AppResult<T> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("command sqlite connection"))?;

        operation(&conn)
    }

    pub(crate) fn with_connection_mut<T>(
        &self,
        operation: impl FnOnce(&mut Connection) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut conn = self
            .conn
            .lock()
            .map_err(|_| AppError::StateLockPoisoned("command sqlite connection"))?;

        operation(&mut conn)
    }
}

fn configure_connection(conn: &Connection) -> AppResult<()> {
    conn.busy_timeout(Duration::from_secs(5))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}

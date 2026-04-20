using Microsoft.Data.Sqlite;

namespace TacTacToe.Data;

public static class DatabaseInitializer
{
    public static void Initialize(string dbPath)
    {
        var dir = Path.GetDirectoryName(dbPath);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);

        using var conn = new SqliteConnection($"Data Source={dbPath}");
        conn.Open();

        // WAL mode gives better concurrent read/write performance
        using var wal = conn.CreateCommand();
        wal.CommandText = "PRAGMA journal_mode=WAL;";
        wal.ExecuteNonQuery();

        // Create tables
        using var create = conn.CreateCommand();
        create.CommandText = @"
            CREATE TABLE IF NOT EXISTS Users (
                Id           INTEGER PRIMARY KEY AUTOINCREMENT,
                Username     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
                PasswordHash TEXT    NOT NULL,
                CreatedAt    TEXT    NOT NULL,
                LastLoginAt  TEXT,
                IsAdmin      INTEGER NOT NULL DEFAULT 0,
                IsBanned     INTEGER NOT NULL DEFAULT 0,
                BannedAt     TEXT,
                BanReason    TEXT
            );

            CREATE TABLE IF NOT EXISTS GameSessions (
                Id          INTEGER PRIMARY KEY AUTOINCREMENT,
                UserId      INTEGER NOT NULL REFERENCES Users(Id),
                GameType    TEXT    NOT NULL,
                Score       INTEGER NOT NULL DEFAULT 0,
                Result      TEXT    NOT NULL,
                TimePlayed  INTEGER NOT NULL DEFAULT 0,
                PlayedAt    TEXT    NOT NULL,
                Details     TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_gs_userid   ON GameSessions(UserId);
            CREATE INDEX IF NOT EXISTS idx_gs_gametype ON GameSessions(GameType);
            CREATE INDEX IF NOT EXISTS idx_gs_lb       ON GameSessions(GameType, Score DESC);
            CREATE INDEX IF NOT EXISTS idx_gs_playedat ON GameSessions(PlayedAt);
        ";
        create.ExecuteNonQuery();

        // Migrations for databases that pre-date these columns
        MigrateAddColumn(conn, "Users", "IsAdmin",   "INTEGER NOT NULL DEFAULT 0");
        MigrateAddColumn(conn, "Users", "IsBanned",  "INTEGER NOT NULL DEFAULT 0");
        MigrateAddColumn(conn, "Users", "BannedAt",  "TEXT");
        MigrateAddColumn(conn, "Users", "BanReason", "TEXT");

        // Auto-promote any user whose username is exactly "admin" (case-insensitive)
        using var promote = conn.CreateCommand();
        promote.CommandText = "UPDATE Users SET IsAdmin = 1 WHERE Username = 'admin' COLLATE NOCASE;";
        promote.ExecuteNonQuery();
    }

    private static void MigrateAddColumn(SqliteConnection conn, string table, string column, string definition)
    {
        using var check = conn.CreateCommand();
        check.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = '{column}';";
        if (Convert.ToInt32(check.ExecuteScalar()) == 0)
        {
            using var alter = conn.CreateCommand();
            alter.CommandText = $"ALTER TABLE {table} ADD COLUMN {column} {definition};";
            alter.ExecuteNonQuery();
        }
    }
}

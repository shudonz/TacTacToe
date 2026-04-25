using Dapper;
using Microsoft.Data.Sqlite;
using TacTacToe.Models;

namespace TacTacToe.Data;

public class GameSessionRepository
{
    private readonly string _cs;

    public GameSessionRepository(string dbPath) => _cs = $"Data Source={dbPath}";

    private SqliteConnection Open()
    {
        var c = new SqliteConnection(_cs);
        c.Open();
        return c;
    }

    public async Task SaveAsync(GameSession s)
    {
        using var c = Open();
        await c.ExecuteAsync(
            @"INSERT INTO GameSessions (UserId, GameType, Score, Result, TimePlayed, PlayedAt, Details)
              VALUES (@UserId, @GameType, @Score, @Result, @TimePlayed, @PlayedAt, @Details)",
            new
            {
                s.UserId,
                s.GameType,
                s.Score,
                s.Result,
                s.TimePlayed,
                PlayedAt = string.IsNullOrEmpty(s.PlayedAt) ? DateTime.UtcNow.ToString("o") : s.PlayedAt,
                s.Details
            });
    }

    public async Task<IEnumerable<GameSession>> GetLeaderboardAsync(string gameType, int top = 10)
    {
        using var c = Open();
        return await c.QueryAsync<GameSession>(
            @"SELECT gs.Id, gs.UserId, gs.GameType, gs.Score, gs.Result, gs.TimePlayed,
                     gs.PlayedAt, u.Username
              FROM GameSessions gs
              JOIN Users u ON u.Id = gs.UserId
              WHERE gs.GameType = @gt
              ORDER BY gs.Score DESC, gs.TimePlayed ASC
              LIMIT @top",
            new { gt = gameType, top });
    }

    public async Task<IEnumerable<GameSession>> GetUserHistoryAsync(int userId, string? gameType = null, int limit = 50)
    {
        using var c = Open();
        var sql = gameType == null
            ? @"SELECT gs.*, u.Username FROM GameSessions gs
                JOIN Users u ON u.Id = gs.UserId
                WHERE gs.UserId = @uid
                ORDER BY gs.PlayedAt DESC LIMIT @limit"
            : @"SELECT gs.*, u.Username FROM GameSessions gs
                JOIN Users u ON u.Id = gs.UserId
                WHERE gs.UserId = @uid AND gs.GameType = @gt
                ORDER BY gs.PlayedAt DESC LIMIT @limit";
        return await c.QueryAsync<GameSession>(sql, new { uid = userId, gt = gameType, limit });
    }

    public async Task<IEnumerable<dynamic>> GetUserStatsAsync(int userId)
    {
        using var c = Open();
        return await c.QueryAsync(
            @"SELECT GameType,
                     COUNT(*)  AS GamesPlayed,
                     MAX(Score) AS BestScore,
                     CAST(ROUND(AVG(Score), 1) AS TEXT) AS AvgScore,
                     SUM(CASE WHEN Result = 'Win' THEN 1 ELSE 0 END) AS Wins,
                     SUM(CASE WHEN Result = 'GiveUp' THEN 1 ELSE 0 END) AS GiveUps,
                     SUM(TimePlayed) AS TotalTimePlayed
              FROM GameSessions
              WHERE UserId = @uid
              GROUP BY GameType",
            new { uid = userId });
    }

    // ── Admin methods ────────────────────────────────────────

    public async Task<IEnumerable<GameSession>> GetAllSessionsAsync(int limit = 200)
    {
        using var c = Open();
        return await c.QueryAsync<GameSession>(
            @"SELECT gs.Id, gs.UserId, gs.GameType, gs.Score, gs.Result, gs.TimePlayed,
                     gs.PlayedAt, u.Username
              FROM GameSessions gs
              JOIN Users u ON u.Id = gs.UserId
              ORDER BY gs.PlayedAt DESC
              LIMIT @limit",
            new { limit });
    }

    public async Task<bool> DeleteSessionAsync(int sessionId)
    {
        using var c = Open();
        var rows = await c.ExecuteAsync(
            "DELETE FROM GameSessions WHERE Id = @id", new { id = sessionId });
        return rows > 0;
    }

    public async Task<int> DeleteUserSessionsAsync(int userId)
    {
        using var c = Open();
        return await c.ExecuteAsync(
            "DELETE FROM GameSessions WHERE UserId = @uid", new { uid = userId });
    }

    public async Task<int> DeleteSessionsByGameTypeAsync(int userId, string gameType)
    {
        using var c = Open();
        return await c.ExecuteAsync(
            "DELETE FROM GameSessions WHERE UserId = @uid AND GameType = @gt",
            new { uid = userId, gt = gameType });
    }

    public async Task<object> GetPlatformStatsAsync()
    {
        using var c = Open();

        var summary = await c.QueryFirstAsync(
            @"SELECT
                (SELECT COUNT(*) FROM Users)                                                           AS totalUsers,
                (SELECT COUNT(*) FROM Users WHERE IsBanned = 1)                                        AS bannedUsers,
                (SELECT COUNT(*) FROM Users WHERE CreatedAt >= datetime('now', '-7 days'))              AS newUsersLast7Days,
                (SELECT COUNT(DISTINCT UserId) FROM GameSessions
                    WHERE PlayedAt >= datetime('now', '-7 days'))                                       AS activeUsersLast7Days,
                COALESCE((SELECT COUNT(*) FROM GameSessions), 0)                                       AS totalSessions,
                COALESCE((SELECT SUM(TimePlayed) FROM GameSessions), 0)                                AS totalTimeSecs,
                COALESCE((SELECT ROUND(AVG(TimePlayed),1) FROM GameSessions WHERE TimePlayed > 0), 0)  AS avgSessionSecs");

        var gameBreakdown = (await c.QueryAsync(
            @"SELECT
                GameType                                                  AS gameType,
                COUNT(*)                                                  AS count,
                SUM(CASE WHEN Result = 'Win'  THEN 1 ELSE 0 END)         AS wins,
                SUM(CASE WHEN Result = 'Loss' THEN 1 ELSE 0 END)         AS losses,
                SUM(CASE WHEN Result = 'Draw' THEN 1 ELSE 0 END)         AS draws,
                SUM(CASE WHEN Result = 'GiveUp' THEN 1 ELSE 0 END)       AS giveUps,
                ROUND(AVG(Score), 1)                                      AS avgScore,
                SUM(TimePlayed)                                           AS totalTimeSecs,
                ROUND(AVG(NULLIF(TimePlayed, 0)), 0)                      AS avgTimeSecs
              FROM GameSessions
              GROUP BY GameType
              ORDER BY count DESC")).ToList();

        var topPlayers = (await c.QueryAsync(
            @"SELECT
                u.Username                                                                   AS username,
                COUNT(gs.Id)                                                                 AS gamesPlayed,
                SUM(CASE WHEN gs.Result = 'Win' THEN 1 ELSE 0 END)                          AS wins,
                ROUND(100.0 * SUM(CASE WHEN gs.Result='Win' THEN 1 ELSE 0 END)
                            / COUNT(gs.Id), 1)                                               AS winRate,
                SUM(gs.Score)                                                                AS totalScore,
                SUM(gs.TimePlayed)                                                           AS totalTimeSecs
              FROM GameSessions gs
              JOIN Users u ON u.Id = gs.UserId
              GROUP BY gs.UserId
              ORDER BY gamesPlayed DESC
              LIMIT 10")).ToList();

        var dailyActivity = (await c.QueryAsync(
            @"SELECT date(PlayedAt) AS date, COUNT(*) AS count
              FROM GameSessions
              WHERE PlayedAt >= datetime('now', '-14 days')
              GROUP BY date(PlayedAt)
              ORDER BY date(PlayedAt)")).ToList();

        return new { summary, gameBreakdown, topPlayers, dailyActivity };
    }

    /// <summary>Looks up a user's ID by their username — used by background tasks that lack UserRepository.</summary>
    public async Task<int?> GetUserIdByUsernameAsync(string username)
    {
        using var c = Open();
        var id = await c.QueryFirstOrDefaultAsync<int?>(
            "SELECT Id FROM Users WHERE Username = @u LIMIT 1", new { u = username });
        return id;
    }
}

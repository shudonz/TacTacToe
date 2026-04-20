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
}

using Dapper;
using Microsoft.Data.Sqlite;
using TacTacToe.Models;

namespace TacTacToe.Data;

public class UserRepository
{
    private readonly string _cs;

    public UserRepository(string dbPath) => _cs = $"Data Source={dbPath}";

    private SqliteConnection Open()
    {
        var c = new SqliteConnection(_cs);
        c.Open();
        return c;
    }

    public async Task<bool> UsernameExistsAsync(string username)
    {
        using var c = Open();
        return await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM Users WHERE Username = @u COLLATE NOCASE",
            new { u = username }) > 0;
    }

    /// <returns>New user Id, or null if the username is already taken.</returns>
    public async Task<int?> CreateUserAsync(string username, string plainPassword)
    {
        var hash = BCrypt.Net.BCrypt.HashPassword(plainPassword, workFactor: 12);
        using var c = Open();
        try
        {
            return await c.ExecuteScalarAsync<int>(
                @"INSERT INTO Users (Username, PasswordHash, CreatedAt)
                  VALUES (@u, @h, @d);
                  SELECT last_insert_rowid();",
                new { u = username, h = hash, d = DateTime.UtcNow.ToString("o") });
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19)
        {
            // UNIQUE constraint — username already taken
            return null;
        }
    }

    /// <returns>The matching user if credentials are valid; null otherwise.</returns>
    public async Task<User?> VerifyLoginAsync(string username, string plainPassword)
    {
        using var c = Open();
        var user = await c.QueryFirstOrDefaultAsync<User>(
            "SELECT * FROM Users WHERE Username = @u COLLATE NOCASE",
            new { u = username });

        if (user == null) return null;

        // BCrypt.Verify uses constant-time comparison — safe against timing attacks
        return BCrypt.Net.BCrypt.Verify(plainPassword, user.PasswordHash) ? user : null;
    }

    public async Task UpdateLastLoginAsync(int userId)
    {
        using var c = Open();
        await c.ExecuteAsync(
            "UPDATE Users SET LastLoginAt = @t WHERE Id = @id",
            new { t = DateTime.UtcNow.ToString("o"), id = userId });
    }

    public async Task<int?> GetIdByUsernameAsync(string username)
    {
        using var c = Open();
        var id = await c.ExecuteScalarAsync<int?>(
            "SELECT Id FROM Users WHERE Username = @u COLLATE NOCASE",
            new { u = username });
        return id == 0 ? null : id;
    }

    // ── Admin methods ────────────────────────────────────────

    public async Task<IEnumerable<User>> GetAllUsersAsync()
    {
        using var c = Open();
        return await c.QueryAsync<User>(
            @"SELECT Id, Username, CreatedAt, LastLoginAt, IsAdmin,
                     IsBanned, BannedAt, BanReason
              FROM Users ORDER BY Username COLLATE NOCASE");
    }

    public async Task<bool> SetAdminAsync(int userId, bool isAdmin)
    {
        using var c = Open();
        var rows = await c.ExecuteAsync(
            "UPDATE Users SET IsAdmin = @a WHERE Id = @id",
            new { a = isAdmin ? 1 : 0, id = userId });
        return rows > 0;
    }

    public async Task<bool> BanUserAsync(int userId, bool isBanned, string? reason)
    {
        using var c = Open();
        var rows = await c.ExecuteAsync(
            @"UPDATE Users SET IsBanned = @b, BannedAt = @t, BanReason = @r WHERE Id = @id",
            new
            {
                b  = isBanned ? 1 : 0,
                t  = isBanned ? DateTime.UtcNow.ToString("o") : (string?)null,
                r  = isBanned ? reason : null,
                id = userId
            });
        return rows > 0;
    }

    public async Task<bool> DeleteUserAsync(int userId)
    {
        using var c = Open();
        // GameSessions are deleted first due to the FK reference
        await c.ExecuteAsync("DELETE FROM GameSessions WHERE UserId = @id", new { id = userId });
        var rows = await c.ExecuteAsync("DELETE FROM Users WHERE Id = @id", new { id = userId });
        return rows > 0;
    }

    public async Task<bool> ResetPasswordAsync(int userId, string newPlainPassword)
    {
        var hash = BCrypt.Net.BCrypt.HashPassword(newPlainPassword, workFactor: 12);
        using var c = Open();
        var rows = await c.ExecuteAsync(
            "UPDATE Users SET PasswordHash = @h WHERE Id = @id",
            new { h = hash, id = userId });
        return rows > 0;
    }

    public async Task<bool> ChangePasswordAsync(int userId, string oldPlainPassword, string newPlainPassword)
    {
        using var c = Open();
        var user = await c.QueryFirstOrDefaultAsync<User>(
            "SELECT * FROM Users WHERE Id = @id", new { id = userId });
        if (user == null) return false;
        if (!BCrypt.Net.BCrypt.Verify(oldPlainPassword, user.PasswordHash)) return false;
        var hash = BCrypt.Net.BCrypt.HashPassword(newPlainPassword, workFactor: 12);
        await c.ExecuteAsync("UPDATE Users SET PasswordHash = @h WHERE Id = @id",
            new { h = hash, id = userId });
        return true;
    }

    public async Task<bool> UpdateAvatarAsync(int userId, string avatar)
    {
        using var c = Open();
        var rows = await c.ExecuteAsync(
            "UPDATE Users SET Avatar = @a WHERE Id = @id",
            new { a = avatar, id = userId });
        return rows > 0;
    }

    public async Task<bool> UpdateSecurityAnswerAsync(int userId, string answer)
    {
        var hashed = BCrypt.Net.BCrypt.HashPassword(answer.Trim().ToLowerInvariant(), workFactor: 10);
        using var c = Open();
        var rows = await c.ExecuteAsync(
            "UPDATE Users SET SecurityAnswer = @a WHERE Id = @id",
            new { a = hashed, id = userId });
        return rows > 0;
    }

    /// <summary>Resets a user's password if their security answer matches.</summary>
    public async Task<bool> ResetPasswordBySecurityAnswerAsync(string username, string answer, string newPlainPassword)
    {
        using var c = Open();
        var user = await c.QueryFirstOrDefaultAsync<User>(
            "SELECT * FROM Users WHERE Username = @u COLLATE NOCASE", new { u = username });
        if (user == null || string.IsNullOrEmpty(user.SecurityAnswer)) return false;
        if (!BCrypt.Net.BCrypt.Verify(answer.Trim().ToLowerInvariant(), user.SecurityAnswer)) return false;
        var hash = BCrypt.Net.BCrypt.HashPassword(newPlainPassword, workFactor: 12);
        await c.ExecuteAsync("UPDATE Users SET PasswordHash = @h WHERE Id = @id",
            new { h = hash, id = user.Id });
        return true;
    }

    public async Task<bool> HasSecurityAnswerAsync(string username)
    {
        using var c = Open();
        var answer = await c.ExecuteScalarAsync<string?>(
            "SELECT SecurityAnswer FROM Users WHERE Username = @u COLLATE NOCASE", new { u = username });
        return !string.IsNullOrEmpty(answer);
    }

    public async Task<string?> GetAvatarAsync(int userId)
    {
        using var c = Open();
        return await c.ExecuteScalarAsync<string?>(
            "SELECT Avatar FROM Users WHERE Id = @id", new { id = userId });
    }
}

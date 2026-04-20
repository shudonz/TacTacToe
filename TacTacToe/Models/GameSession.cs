namespace TacTacToe.Models;

public class GameSession
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string GameType { get; set; } = "";
    public int Score { get; set; }
    public string Result { get; set; } = "";
    public int TimePlayed { get; set; }
    public string PlayedAt { get; set; } = "";
    public string? Details { get; set; }

    // Joined from Users table for display purposes only
    public string Username { get; set; } = "";
}

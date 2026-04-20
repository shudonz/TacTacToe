namespace TacTacToe.Models;

public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string CreatedAt { get; set; } = "";
    public string? LastLoginAt { get; set; }
    public bool IsAdmin { get; set; }
}

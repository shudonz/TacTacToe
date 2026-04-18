FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY TacTacToe/TacTacToe.csproj TacTacToe/
RUN dotnet restore TacTacToe/TacTacToe.csproj
COPY TacTacToe/ TacTacToe/
WORKDIR /src/TacTacToe
RUN dotnet publish -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "TacTacToe.dll"]

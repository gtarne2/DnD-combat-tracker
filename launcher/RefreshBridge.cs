using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;

// The file preview knows only an unguessable loopback URL. The launcher keeps all source paths.
internal sealed class RefreshBridge : IDisposable
{
    private readonly TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
    private readonly string token = Guid.NewGuid().ToString("N");
    private readonly Func<string, Task<string>> generate;
    private readonly string previews;
    private string preview;
    private string pending;
    private string stagedRevision;
    private bool stopped;
    public string Url { get; private set; }

    internal RefreshBridge(string previews, Func<string, Task<string>> generate)
    {
        this.previews = previews;
        this.generate = generate;
        listener.Start();
        Url = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port + "/" + token;
    }

    internal async Task<string> Open()
    {
        await Stage();
        Apply(stagedRevision);
        Listen();
        return preview;
    }

    private async Task<string> Stage()
    {
        var revision = Guid.NewGuid().ToString("N");
        var directory = Path.Combine(previews, ".staging-" + revision);
        string generated = null;
        try
        {
            generated = await generate(directory);
            var html = File.ReadAllText(generated, Encoding.UTF8).Replace("<body data-profile=",
                "<body data-refresh-url=\"" + Url + "\" data-refresh-revision=\"" + revision + "\" data-profile=");
            var destination = Path.Combine(previews, Path.GetFileName(generated));
            if (preview != null && preview != destination)
                throw new InvalidOperationException("The Aurora save resolved to a different tracker session.");
            if (stopped) throw new InvalidOperationException("The refresh service has stopped.");
            DiscardStaged();
            var candidate = Path.Combine(previews, ".refresh-" + revision + ".tmp");
            try { File.WriteAllText(candidate, html, new UTF8Encoding(false)); }
            catch { Delete(candidate); throw; }
            preview = destination;
            pending = candidate;
            stagedRevision = revision;
            return html;
        }
        finally
        {
            Delete(generated);
            try { Directory.Delete(directory); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    private void Apply(string revision)
    {
        if (pending == null || revision != stagedRevision)
            throw new InvalidOperationException("This import preview is no longer current. Refresh again.");
        if (File.Exists(preview)) File.Replace(pending, preview, null);
        else File.Move(pending, preview);
        pending = null;
        stagedRevision = null;
    }

    private async void Listen()
    {
        while (!stopped)
        {
            try
            {
                using (var client = await listener.AcceptTcpClientAsync())
                    await Handle(client);
            }
            catch (SocketException) { if (stopped) return; }
            catch (ObjectDisposedException) { return; }
            catch (IOException) { }
        }
    }

    private async Task Handle(TcpClient client)
    {
        var stream = client.GetStream();
        var buffer = new byte[8192];
        var length = 0;
        string request = String.Empty;
        while (length < buffer.Length && !request.Contains("\r\n\r\n"))
        {
            var read = stream.ReadAsync(buffer, length, buffer.Length - length);
            if (await Task.WhenAny(read, Task.Delay(3000)) != read) return;
            var size = await read;
            if (size == 0) return;
            length += size;
            request = Encoding.ASCII.GetString(buffer, 0, length);
        }
        if (!request.Contains("\r\n\r\n")) return;
        var headers = request.Split(new[] { "\r\n" }, StringSplitOptions.None);
        var route = headers[0].Split(' ');
        if (route.Length != 3 || !route[1].StartsWith("/" + token + "/", StringComparison.Ordinal)) return;
        foreach (var header in headers)
            if (header.StartsWith("Origin:", StringComparison.OrdinalIgnoreCase) && header.Substring(7).Trim() != "null") return;
        string body = "";
        string status = "200 OK";
        var action = route[1].Substring(token.Length + 2);
        try
        {
            if (route[0] == "OPTIONS") status = "204 No Content";
            else if (route[0] == "POST" && action == "stage") body = await Stage();
            else if (route[0] == "POST" && action.StartsWith("apply/", StringComparison.Ordinal)) Apply(action.Substring(6));
            else status = "404 Not Found";
        }
        catch (Exception error)
        {
            status = "400 Bad Request";
            body = error.Message;
        }
        var data = Encoding.UTF8.GetBytes(body);
        var response = Encoding.ASCII.GetBytes("HTTP/1.1 " + status
            + "\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close"
            + "\r\nAccess-Control-Allow-Origin: null\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Private-Network: true"
            + "\r\nContent-Length: " + data.Length + "\r\n\r\n");
        await stream.WriteAsync(response, 0, response.Length);
        await stream.WriteAsync(data, 0, data.Length);
    }

    private static void Delete(string path)
    {
        if (path == null) return;
        try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private void DiscardStaged() { Delete(pending); pending = null; stagedRevision = null; }

    public void Dispose()
    {
        stopped = true;
        listener.Stop();
        DiscardStaged();
    }
}

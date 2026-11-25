using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class PartySession : IDisposable
{
    private Process helper;
    internal string Url { get; private set; }
    internal string Role { get; private set; }
    private string lobby;

    internal static async Task<PartySession> Start(object options)
    {
        var serializer = new JavaScriptSerializer();
        var proc = new Process { StartInfo = new ProcessStartInfo(
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "aurora-party.exe"), "serve") {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
            RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8
        }};
        proc.Start();
        var session = new PartySession { helper = proc };
        try {
            // ASCII JSON escapes keep display names independent of the Windows console code page.
            var line = new StringBuilder();
            foreach (char c in serializer.Serialize(options))
                line.Append(c < 128 ? c.ToString() : "\\u" + ((int)c).ToString("x4"));
            proc.StandardInput.WriteLine(line.ToString());
            proc.StandardInput.Flush();
            var errors = proc.StandardError.ReadToEndAsync();
            var read = proc.StandardOutput.ReadLineAsync();
            if (await Task.WhenAny(read, Task.Delay(20000)) != read) throw new IOException("Party helper timed out.");
            string reply = await read;
            if (reply == null) throw new IOException((await errors).Trim());
            var ready = serializer.Deserialize<Dictionary<string,string>>(reply);
            session.Url = ready["url"]; session.Role = ready["role"];
            return session;
        } catch { session.Dispose(); throw; }
    }
    internal void OpenLobby(string directory)
    {
        Process.Start(new ProcessStartInfo(WriteLobby(directory)) {UseShellExecute=true});
    }
    internal string WriteLobby(string directory)
    {
        Directory.CreateDirectory(directory);
        lobby = Path.Combine(directory,"dm-party-" + Guid.NewGuid().ToString("N") + ".html");
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("party.js"))
        using (var reader = new StreamReader(stream))
            File.WriteAllText(lobby, "<!doctype html><meta charset=utf-8><title>DM party</title><body data-party-lobby='true' data-party-url='" +
                WebUtility.HtmlEncode(Url) + "'><main><h1>DM party</h1><div id='party-controls'></div></main><script>" + reader.ReadToEnd() + "</script>", new UTF8Encoding(false));
        return lobby;
    }
    public void Dispose()
    {
        if (helper != null) {
            try { helper.StandardInput.Close(); if (!helper.WaitForExit(1500)) helper.Kill(); }
            catch (InvalidOperationException) {} catch (IOException) {}
            helper.Dispose(); helper=null;
        }
        if (lobby!=null) { try { File.Delete(lobby); } catch(IOException) {} catch(UnauthorizedAccessException) {} }
    }

    internal static object Choose(Form parent, string mode, string character)
    {
        bool dm = mode == "dm" || mode == "resume-dm";
        if (!dm && String.IsNullOrEmpty(character)) throw new IOException("Select a character first.");
        using (var form = new Form {Text="Party",ClientSize=new Size(470,218),FormBorderStyle=FormBorderStyle.FixedDialog,
            MaximizeBox=false,MinimizeBox=false,StartPosition=FormStartPosition.CenterParent}) {
            bool resuming = mode.StartsWith("resume");
            var name = new TextBox { Text = dm ? "DM" : Path.GetFileNameWithoutExtension(character), MaxLength = 120 };
            var invite = new TextBox();
            var adapter = new ComboBox {DropDownStyle=ComboBoxStyle.DropDownList};
            var addresses = new List<IPAddress>();
            if (resuming) {
                adapter.Items.Add("Saved host adapter");
                addresses.Add(null);
            }
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces().Where(n=>n.OperationalStatus==OperationalStatus.Up)
                .OrderByDescending(n=>n.NetworkInterfaceType==NetworkInterfaceType.Wireless80211)
                .ThenBy(n=>n.NetworkInterfaceType==NetworkInterfaceType.Loopback))
                foreach(var addr in nic.GetIPProperties().UnicastAddresses.Where(a=>a.Address.AddressFamily==AddressFamily.InterNetwork)) {
                    adapter.Items.Add(nic.Name+" ("+addr.Address+")"); addresses.Add(addr.Address);
                }
            if (addresses.Count>0) adapter.SelectedIndex=0;
            string[] labels={"Display name","Host adapter","Invitation"};
            Control[] inputs={name,adapter,invite};
            for(int i=0;i<inputs.Length;i++) {
                var label=new Label {Text=labels[i]}; label.SetBounds(12,15+i*47,103,24);
                inputs[i].SetBounds(118,12+i*47,334,28);
                form.Controls.Add(label); form.Controls.Add(inputs[i]);
            }
            name.Enabled = !resuming;
            adapter.Enabled = mode != "join";
            invite.Enabled = mode == "join";
            var ok=new Button {Text=mode.StartsWith("resume")?"Resume":mode=="join"?"Join":"Host",DialogResult=DialogResult.OK};
            ok.SetBounds(345,166,106,32); form.Controls.Add(ok);form.AcceptButton=ok;
            if (form.ShowDialog(parent) != DialogResult.OK) return null;
            if (adapter.Enabled && adapter.SelectedIndex < 0) throw new IOException("No IPv4 adapter available.");
            var address = adapter.Enabled ? addresses[adapter.SelectedIndex] : null;
            return new {
                mode = resuming ? "resume" : mode,
                profile = dm ? "dm" : "sheet:" + Path.GetFullPath(character).ToUpperInvariant(),
                name = name.Text.Trim(),
                invite = invite.Text.Trim(),
                bind = address == null ? null : address.ToString()
            };
        }
    }
}

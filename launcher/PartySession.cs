using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;

internal sealed class PartySession : IDisposable
{
    private Process helper;
    private SafeFileHandle helperJob;
    internal string Url { get; private set; }
    internal string Role { get; private set; }
    internal bool IsHosting { get { return Role == "host" || Role == "dm"; } }
    private string lobby;

    internal static async Task<PartySession> Start(object options)
    {
        var serializer = new JavaScriptSerializer();
        var proc = new Process { StartInfo = new ProcessStartInfo(
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "aurora-party.exe"), "serve") {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
            RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8
        }};
        var session = new PartySession { helper = proc };
        try {
            session.helperJob = CreateHelperJob();
            proc.Start();
            if (session.helperJob != null && !AssignProcessToJobObject(session.helperJob, proc.Handle))
            {
                // A restrictive parent job can reject nesting. The helper still watches stdin.
                session.helperJob.Dispose();
                session.helperJob = null;
            }
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
    internal async Task<bool> HasActiveRoom()
    {
        if (helper == null || helper.HasExited) return false;
        using (var client = new WebClient { Proxy = null })
        {
            client.Headers["Origin"] = "null";
            try
            {
                var response = client.UploadStringTaskAsync(new Uri(Url + "/state"), "POST", "");
                if (await Task.WhenAny(response, Task.Delay(3000)) != response)
                {
                    client.CancelAsync();
                    return true;
                }
                var state = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(await response);
                object ended;
                // A detached host still owns its room. Only a closed room has both fields.
                return state == null || !state.TryGetValue("ended", out ended) ||
                    !Equals(ended, true) || !state.ContainsKey("room_id");
            }
            catch (WebException) { return true; }
            catch (ArgumentException) { return true; }
            catch (InvalidOperationException) { return true; }
        }
    }
    private static string ReadAsset(string name)
    {
        using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        using (var reader = new StreamReader(stream))
            return reader.ReadToEnd();
    }
    internal string WriteLobby(string directory, string refreshUrl)
    {
        Directory.CreateDirectory(directory);
        lobby = Path.Combine(directory,"dm-party-" + Guid.NewGuid().ToString("N") + ".html");
        File.WriteAllText(lobby,
            "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>" +
            "<title>DM dashboard · Aurora Combat Tracker</title><style>" + ReadAsset("dm-dashboard.css") +
            "</style></head><body data-party-lobby='true' data-party-url='" + WebUtility.HtmlEncode(Url) +
            "' data-refresh-url='" + WebUtility.HtmlEncode(refreshUrl) + "'>" +
            ReadAsset("dm-dashboard.html") + "<script>" + ReadAsset("dm-dashboard.js") + "\n" + ReadAsset("dm-initiative.js") + "\n" + ReadAsset("dm-monsters.js") + "\n" + ReadAsset("dm-monster-assist.js") + "\n" + ReadAsset("dm-monster-actions.js") + "\n" + ReadAsset("dm-table.js") + "\n" + ReadAsset("party.js") +
            "</script></body></html>", new UTF8Encoding(false));
        return lobby;
    }
    public void Dispose()
    {
        try
        {
            if (helper != null) {
                try { helper.StandardInput.Close(); if (!helper.WaitForExit(1500)) helper.Kill(); }
                catch (InvalidOperationException) {} catch (IOException) {} catch (Win32Exception) {}
            }
        }
        finally
        {
            if (helperJob != null) { helperJob.Dispose(); helperJob = null; }
            if (helper != null) { helper.Dispose(); helper = null; }
        }
        if (lobby!=null) { try { File.Delete(lobby); } catch(IOException) {} catch(UnauthorizedAccessException) {} }
    }

    private static SafeFileHandle CreateHelperJob()
    {
        const int extendedLimitInformation = 9;
        const uint killOnJobClose = 0x2000;
        var job = CreateJobObject(IntPtr.Zero, null);
        var limits = new JobExtendedLimits { Basic = new JobBasicLimits { LimitFlags = killOnJobClose } };
        if (!job.IsInvalid && SetInformationJobObject(job, extendedLimitInformation, ref limits, Marshal.SizeOf(limits)))
            return job;
        job.Dispose();
        return null;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobBasicLimits
    {
        internal long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        internal uint LimitFlags;
        internal UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        internal uint ActiveProcessLimit;
        internal UIntPtr Affinity;
        internal uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobIoCounters
    {
        internal ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        internal ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobExtendedLimits
    {
        internal JobBasicLimits Basic;
        internal JobIoCounters Io;
        internal UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern SafeFileHandle CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll")]
    private static extern bool SetInformationJobObject(SafeFileHandle job, int informationClass,
        ref JobExtendedLimits information, int length);

    [DllImport("kernel32.dll")]
    private static extern bool AssignProcessToJobObject(SafeFileHandle job, IntPtr process);

    internal static object Choose(Form parent, string mode, string character, string[] bestiary)
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
                bind = address == null ? null : address.ToString(),
                bestiary = dm ? bestiary : new string[0]
            };
        }
    }
}

using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Optional DM dashboard window (R79). It hosts the dashboard page in WebView2 and asks Windows to
// leave the window out of screen capture, so the DM can cast the whole screen while the dashboard
// stays private. WebView2 is loaded by reflection from DLLs next to the exe, so the launcher still
// builds and runs without them; a missing SDK or runtime falls back to the default browser.
internal sealed class DmWindow : Form
{
    private const uint ExcludeFromCapture = 0x11; // WDA_EXCLUDEFROMCAPTURE, Windows 10 2004 and later
    private const uint MonitorOnly = 0x01;        // WDA_MONITOR: shows black in captures on older Windows
    private static DmWindow current;
    private readonly string page;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowDisplayAffinity(IntPtr window, uint affinity);

    private DmWindow(Control view, string page)
    {
        this.page = page;
        Text = "DM dashboard (hidden from casting) · Aurora Combat Tracker";
        Icon = SystemIcons.Application;
        StartPosition = FormStartPosition.CenterScreen;
        var area = Screen.PrimaryScreen.WorkingArea;
        Size = new Size(Math.Min(1400, area.Width - 40), Math.Min(950, area.Height - 40));
        view.Dock = DockStyle.Fill;
        Controls.Add(view);
        HandleCreated += delegate {
            if (SetWindowDisplayAffinity(Handle, ExcludeFromCapture)) return;
            if (SetWindowDisplayAffinity(Handle, MonitorOnly))
                Text = "DM dashboard (blacked out in casts) · Aurora Combat Tracker";
            else
                Text = "DM dashboard (NOT hidden from casting) · Aurora Combat Tracker";
        };
        FormClosed += delegate { if (current == this) current = null; };
    }

    // Opens or replaces the private dashboard window. Returns false when WebView2 is unavailable,
    // with the reason, so the caller can open the page in the browser instead.
    internal static bool TryOpen(string page, string dataFolder, out string reason)
    {
        reason = null;
        try
        {
            string directory = AppDomain.CurrentDomain.BaseDirectory;
            string winforms = Path.Combine(directory, "Microsoft.Web.WebView2.WinForms.dll");
            string core = Path.Combine(directory, "Microsoft.Web.WebView2.Core.dll");
            if (!File.Exists(winforms) || !File.Exists(core) || !File.Exists(Path.Combine(directory, "WebView2Loader.dll")))
            {
                reason = "The WebView2 files are missing next to the launcher.";
                return false;
            }
            Assembly.LoadFrom(core);
            var assembly = Assembly.LoadFrom(winforms);
            var control = (Control)Activator.CreateInstance(assembly.GetType("Microsoft.Web.WebView2.WinForms.WebView2", true));
            var properties = Activator.CreateInstance(assembly.GetType("Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties", true));
            Directory.CreateDirectory(dataFolder);
            properties.GetType().GetProperty("UserDataFolder").SetValue(properties, dataFolder, null);
            control.GetType().GetProperty("CreationProperties").SetValue(control, properties, null);
            if (current != null && !current.IsDisposed) current.Close();
            current = new DmWindow(control, page);
            var started = control.GetType().GetEvent("CoreWebView2InitializationCompleted");
            if (started != null)
                started.AddEventHandler(control, Delegate.CreateDelegate(started.EventHandlerType, current,
                    typeof(DmWindow).GetMethod("Started", BindingFlags.NonPublic | BindingFlags.Instance)));
            current.Show();
            // Setting Source starts WebView2 and navigates once the runtime is ready.
            control.GetType().GetProperty("Source").SetValue(control, new Uri(page), null);
            return true;
        }
        catch (Exception error)
        {
            if (current != null && !current.IsDisposed) current.Close();
            current = null;
            var inner = error is TargetInvocationException && error.InnerException != null ? error.InnerException : error;
            reason = inner.Message;
            return false;
        }
    }

    // A missing WebView2 runtime only shows up here, after the window opened.
    private void Started(object sender, EventArgs args)
    {
        var success = args.GetType().GetProperty("IsSuccess");
        if (success == null || (bool)success.GetValue(args, null)) return;
        var error = args.GetType().GetProperty("InitializationException");
        var failure = error == null ? null : error.GetValue(args, null) as Exception;
        Close();
        MessageBox.Show("The private DM window needs the Microsoft Edge WebView2 Runtime, which comes with Windows 11 " +
            "and current Windows 10. The dashboard will open in your browser instead." +
            (failure == null ? "" : "\n\n" + failure.Message), "Private DM window unavailable",
            MessageBoxButtons.OK, MessageBoxIcon.Warning);
        using (System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(page) { UseShellExecute = true })) { }
    }

    internal static bool Reopen()
    {
        if (current == null || current.IsDisposed) return false;
        current.Show();
        if (current.WindowState == FormWindowState.Minimized) current.WindowState = FormWindowState.Normal;
        current.Activate();
        return true;
    }

    internal static void CloseCurrent()
    {
        if (current != null && !current.IsDisposed) current.Close();
        current = null;
    }
}

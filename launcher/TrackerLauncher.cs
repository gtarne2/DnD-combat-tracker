using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

// Version details for the file's Properties page. An unsigned exe with blank details looks more
// like throwaway malware to antivirus heuristics, so the launcher says what it is.
[assembly: AssemblyTitle("Aurora Combat Tracker")]
[assembly: AssemblyDescription("Launcher for the Aurora Combat Tracker D&D 5e combat sheet and LAN party room")]
[assembly: AssemblyProduct("Aurora Combat Tracker")]
[assembly: AssemblyCompany("Aurora Combat Tracker")]
[assembly: AssemblyCopyright("Personal project")]
[assembly: AssemblyVersion("0.1.0.0")]
[assembly: AssemblyFileVersion("0.1.0.0")]

internal sealed class TrackerLauncher : Form
{
    private static readonly string tracker = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "combat-sheet.exe");
    private readonly string appData = Path.Combine(
        Environment.GetEnvironmentVariable("LOCALAPPDATA") ??
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Aurora Combat Tracker");
    private readonly TextBox character = new TextBox { ReadOnly = true, TabStop = false };
    private readonly ListBox content = new ListBox
    {
        FormattingEnabled = true,
        HorizontalScrollbar = true,
        IntegralHeight = false
    };
    private readonly Button remove = new Button { Text = "Remove" };
    private readonly Button up = new Button { Text = "Move up" };
    private readonly Button down = new Button { Text = "Move down" };
    private readonly Button open = new Button { Text = "Open Combat Sheet" };
    private readonly Label status = new Label();
    private readonly Panel selection = new Panel { Dock = DockStyle.Top, Height = 290 };
    private string characterPath;
    private RefreshBridge bridge;
    private PartySession party;
    // A DM room kept running while this PC also opens a player sheet, for testing both sides
    // on one machine. Its dashboard bridge stays with it.
    private PartySession hostedParty;
    private RefreshBridge hostedBridge;
    private readonly Stopwatch lifecycleTick = Stopwatch.StartNew();
    private readonly Stopwatch hostProbe = new Stopwatch();
    private bool checkingHost;
    private readonly NotifyIcon tray = new NotifyIcon { Text = "Aurora Combat Tracker", Icon = SystemIcons.Application };
    private string SettingsPath { get { return Path.Combine(appData, "last-import.txt"); } }

    [STAThread]
    private static void Main()
    {
        string name;
        using (var user = WindowsIdentity.GetCurrent())
            name = @"Local\AuroraCombatTracker-" + user.User.Value;
        using (var activate = new EventWaitHandle(false, EventResetMode.AutoReset, name + "-activate"))
        using (var instance = new Mutex(false, name))
        {
            bool ownsInstance;
            try { ownsInstance = instance.WaitOne(0); }
            catch (AbandonedMutexException) { ownsInstance = true; }
            if (!ownsInstance)
            {
                activate.Set();
                return;
            }
            try
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (var launcher = new TrackerLauncher(activate))
                    Application.Run(launcher);
            }
            finally { instance.ReleaseMutex(); }
        }
    }

    private TrackerLauncher(EventWaitHandle activate)
    {
        Text = "Aurora Combat Tracker";
        ClientSize = new Size(640, 367);
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoScaleDimensions = new SizeF(96, 96);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;

        var browse = new Button { Text = "Browse..." };
        var add = new Button { Text = "Add files..." };
        var folder = new Button { Text = "Add folder..." };
        Controls.Add(selection);
        Place(selection, new Label { Text = "Aurora character (.dnd5e)" }, 16, 15, 608, 22);
        Place(selection, character, 16, 40, 510, 25);
        Place(selection, browse, 536, 38, 88, 26);
        Place(selection, new Label { Text = "Content XML (optional). Put overrides last." }, 16, 80, 608, 22);
        Place(selection, content, 16, 105, 510, 178);
        Place(selection, add, 536, 105, 88, 26);
        Place(selection, folder, 536, 136, 88, 26);
        Place(selection, remove, 536, 167, 88, 26);
        Place(selection, up, 536, 198, 88, 26);
        Place(selection, down, 536, 229, 88, 26);
        Place(this, status, 16, 295, 608, 22);
        Place(this, open, 452, 321, 172, 30);
        var partyButton = new Button { Text = "Party..." };
        Place(selection, partyButton, 536, 259, 88, 26);
        var partyMenu = new ContextMenuStrip();
        foreach (var entry in new[] { new[] { "Host Party", "host" }, new[] { "Host as DM", "dm" },
            new[] { "Join", "join" }, new[] { "Resume party", "resume" }, new[] { "Resume DM room", "resume-dm" } })
        {
            string mode = entry[1];
            partyMenu.Items.Add(entry[0], null, async delegate { await OpenParty(mode); });
        }
        partyButton.Click += delegate { partyMenu.Show(partyButton, 0, partyButton.Height); };
        AcceptButton = open;
        var trayMenu = new ContextMenuStrip();
        trayMenu.Items.Add("Open launcher", null, delegate { ShowLauncher(); });
        trayMenu.Items.Add("Reopen current session", null, delegate {
            if (bridge == null) return;
            try { OpenBrowser(bridge.PreviewPath); bridge.KeepAlive(); }
            catch (Exception error) {
                MessageBox.Show(error.Message, "Could not reopen session", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        });
        trayMenu.Items.Add("Reopen DM dashboard", null, delegate {
            if (hostedBridge == null) return;
            try { OpenBrowser(hostedBridge.PreviewPath); hostedBridge.KeepAlive(); }
            catch (Exception error) {
                MessageBox.Show(error.Message, "Could not reopen the DM dashboard", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        });
        trayMenu.Items.Add("Exit refresh service", null, delegate { Close(); });
        tray.ContextMenuStrip = trayMenu;
        tray.DoubleClick += delegate { ShowLauncher(); };
        var lifecycle = new System.Windows.Forms.Timer { Interval = 1000 };
        lifecycle.Tick += async delegate { await CheckLifecycle(activate); };
        lifecycle.Start();
        FormClosed += delegate {
            lifecycle.Dispose();
            if (bridge != null) bridge.Dispose();
            if (party != null) party.Dispose();
            DisposeHosted();
            partyMenu.Dispose();
            tray.Dispose();
            trayMenu.Dispose();
        };

        browse.Click += delegate { ChooseCharacter(); };
        add.Click += delegate { AddContent(); };
        folder.Click += delegate { AddContentFolder(); };
        content.Format += delegate(object sender, ListControlConvertEventArgs args)
        {
            args.Value = DisplayPath((string)args.ListItem);
        };
        content.SelectedIndexChanged += delegate { UpdateButtons(); };
        remove.Click += delegate
        {
            int index = content.SelectedIndex;
            content.Items.RemoveAt(index);
            content.SelectedIndex = Math.Min(index, content.Items.Count - 1);
            UpdateButtons();
        };
        up.Click += delegate { MoveContent(-1); };
        down.Click += delegate { MoveContent(1); };
        open.Click += async delegate { await OpenSheet(); };
        RestoreSelections();
        UpdateButtons();
    }

    private void ShowLauncher()
    {
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    private async Task CheckLifecycle(EventWaitHandle activate)
    {
        // After sleep, let browsers renew their lease before evaluating idle shutdown.
        if (lifecycleTick.Elapsed >= TimeSpan.FromSeconds(30) && bridge != null) bridge.KeepAlive();
        if (lifecycleTick.Elapsed >= TimeSpan.FromSeconds(30) && hostedBridge != null) hostedBridge.KeepAlive();
        lifecycleTick.Restart();
        if (activate.WaitOne(0)) ShowLauncher();
        if (Visible || !selection.Enabled || bridge == null || !bridge.IsIdle || checkingHost) return;

        var currentBridge = bridge;
        var currentParty = party;
        var currentHosted = hostedParty;
        if (currentHosted != null)
        {
            if (hostProbe.IsRunning && hostProbe.Elapsed < TimeSpan.FromSeconds(15)) return;
            hostProbe.Restart();
            checkingHost = true;
            try { if (await currentHosted.HasActiveRoom()) return; }
            finally { checkingHost = false; }
        }
        if (currentParty != null && currentParty.IsHosting)
        {
            if (hostProbe.IsRunning && hostProbe.Elapsed < TimeSpan.FromSeconds(15)) return;
            hostProbe.Restart();
            checkingHost = true;
            try { if (await currentParty.HasActiveRoom()) return; }
            finally { checkingHost = false; }
        }
        if (!IsDisposed && !Visible && selection.Enabled && currentBridge == bridge &&
            currentParty == party && currentBridge.IsIdle) Close();
    }

    private static void OpenBrowser(string path)
    {
        using (Process.Start(new ProcessStartInfo(path) { UseShellExecute = true })) { }
    }

    private static void Place(Control parent, Control control, int x, int y, int width, int height)
    {
        control.SetBounds(x, y, width, height);
        parent.Controls.Add(control);
    }

    private void ChooseCharacter()
    {
        string directory = characterPath != null
            ? Path.GetDirectoryName(characterPath)
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "5e Character Builder");
        string[] paths = ChooseFiles("Select an Aurora character", "Aurora character (*.dnd5e)|*.dnd5e", directory);
        if (paths.Length == 0)
            return;
        SetCharacter(paths[0]);
        status.Text = "";
        UpdateButtons();
    }

    private string ContentDirectory()
    {
        string directory = null;
        if (content.SelectedItem != null)
        {
            string selected = (string)content.SelectedItem;
            directory = Directory.Exists(selected) ? selected : Path.GetDirectoryName(selected);
        }
        else if (characterPath != null)
        {
            directory = Path.GetDirectoryName(characterPath);
            string custom = Path.Combine(directory, "custom");
            if (Directory.Exists(custom))
                directory = custom;
        }

        return directory;
    }

    private void AddContent()
    {
        var existing = new HashSet<string>(content.Items.Cast<string>(), StringComparer.OrdinalIgnoreCase);
        foreach (string path in ChooseFiles("Select Aurora content XML", "Aurora content (*.xml)|*.xml", ContentDirectory(), true))
        {
            if (existing.Add(path))
                content.SelectedIndex = content.Items.Add(path);
        }
    }

    private void AddContentFolder()
    {
        using (var dialog = new FolderBrowserDialog
        {
            Description = "Select the parent folder containing your Aurora XML. Subfolders are included.",
            SelectedPath = ContentDirectory() ?? "",
            ShowNewFolderButton = false
        })
        {
            if (dialog.ShowDialog(this) != DialogResult.OK)
                return;
            int index = content.Items.Cast<string>().ToList().FindIndex(
                path => StringComparer.OrdinalIgnoreCase.Equals(path, dialog.SelectedPath));
            content.SelectedIndex = index >= 0 ? index : content.Items.Add(dialog.SelectedPath);
        }
    }

    private string[] ChooseFiles(string title, string filter, string directory, bool multiple = false)
    {
        using (var dialog = new OpenFileDialog
        {
            Title = title,
            Filter = filter,
            Multiselect = multiple,
            CheckFileExists = true,
            RestoreDirectory = true,
            InitialDirectory = Directory.Exists(directory) ? directory : ""
        })
        {
            return dialog.ShowDialog(this) == DialogResult.OK ? dialog.FileNames : new string[0];
        }
    }

    private void MoveContent(int offset)
    {
        int index = content.SelectedIndex;
        object item = content.Items[index];
        content.Items.RemoveAt(index);
        content.Items.Insert(index + offset, item);
        content.SelectedIndex = index + offset;
    }

    private void UpdateButtons()
    {
        open.Enabled = selection.Enabled && characterPath != null;
        remove.Enabled = content.SelectedIndex >= 0;
        up.Enabled = content.SelectedIndex > 0;
        down.Enabled = remove.Enabled && content.SelectedIndex < content.Items.Count - 1;
    }

    private static string DisplayPath(string path)
    {
        return Directory.Exists(path) ? "[Folder] " + path
            : Path.GetFileName(path) + "   (" + Path.GetDirectoryName(path) + ")";
    }

    private void SetCharacter(string path)
    {
        characterPath = path;
        character.Text = DisplayPath(path);
    }

    private void RestoreSelections()
    {
        string[] paths;
        try { paths = File.ReadAllLines(SettingsPath); }
        catch (IOException) { return; }
        catch (UnauthorizedAccessException) { return; }
        if (paths.Length == 0 || !File.Exists(paths[0]))
            return;
        SetCharacter(paths[0]);
        foreach (string path in paths.Skip(1).Where(path => path.Length > 0))
            content.Items.Add(path);
    }

    private async Task OpenParty(string mode)
    {
        PartySession candidate = null;
        RefreshBridge lobbyBridge = null;
        try {
            var options = PartySession.Choose(this, mode, characterPath);
            if (options == null) return;
            // Resuming a host reuses its LAN port and creates a fresh sheet capability.
            if (mode.StartsWith("resume") && party != null) {
                party.Dispose();
                party = null;
            }
            if (mode == "dm" || mode == "resume-dm") DisposeHosted();
            selection.Enabled = false;
            UpdateButtons();
            status.Text = "Connecting party...";
            candidate = await PartySession.Start(options);
            if (IsDisposed) return;
            if (candidate.Role == "dm") {
                var previews = Path.Combine(appData, "Previews");
                lobbyBridge = new RefreshBridge(previews, null);
                var lobby = candidate.WriteLobby(previews, lobbyBridge.Url);
                lobbyBridge.TrackLobby(lobby);
                OpenBrowser(lobby);
                if (bridge != null) bridge.Dispose();
                bridge = lobbyBridge;
                lobbyBridge = null;
                tray.Visible = true;
                Hide();
            } else {
                // Joining as a player keeps a DM room on this PC running beside the sheet.
                if (party != null && party.Role == "dm") {
                    DisposeHosted();
                    hostedParty = party;
                    hostedBridge = bridge;
                    party = null;
                    bridge = null;
                }
                if (!await OpenSheet(candidate)) return;
            }
            if (party != null) party.Dispose();
            party = candidate;
            candidate = null;
        } catch (Exception error) {
            if (!IsDisposed) MessageBox.Show(this, error.Message, "Could not open party", MessageBoxButtons.OK, MessageBoxIcon.Error);
        } finally {
            if (lobbyBridge != null) lobbyBridge.Dispose();
            if (candidate != null) candidate.Dispose();
            if (!IsDisposed) {
                selection.Enabled = true;
                UpdateButtons();
                status.Text = "";
            }
        }
    }

    private void DisposeHosted()
    {
        if (hostedBridge != null) hostedBridge.Dispose();
        if (hostedParty != null) hostedParty.Dispose();
        hostedBridge = null;
        hostedParty = null;
    }

    private async Task<bool> OpenSheet(PartySession attached = null)
    {
        selection.Enabled = false;
        UpdateButtons();
        status.Text = "Importing character...";
        string[] sources = new[] { characterPath }.Concat(content.Items.Cast<string>()).ToArray();
        RefreshBridge candidate = null;
        try
        {
            candidate = new RefreshBridge(Path.Combine(appData, "Previews"), directory => GeneratePreview(sources, directory), attached == null ? null : attached.Url);
            string preview = await candidate.Open();
            if (IsDisposed)
                return false;
            OpenBrowser(preview);
            // A solo sheet on the DM's PC leaves the DM room running.
            if (attached == null && party != null && party.Role == "dm") {
                DisposeHosted();
                hostedParty = party;
                hostedBridge = bridge;
                party = null;
                bridge = null;
            }
            if (bridge != null) bridge.Dispose();
            bridge = candidate;
            candidate = null;
            bool remembered = false;
            try { File.WriteAllLines(SettingsPath, sources); remembered = true; }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            if (!remembered)
                MessageBox.Show(this, "The combat sheet opened, but the launcher could not remember these selections.",
                    "Selections not saved", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            status.Text = "";
            tray.Visible = true;
            Hide();
            if (attached == null && party != null) {
                party.Dispose();
                party = null;
            }
            return true;
        }
        catch (Exception error)
        {
            if (IsDisposed)
                return false;
            status.Text = "Check the selected files and try again.";
            MessageBox.Show(this, error.Message, "Could not open combat sheet", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }
        finally
        {
            if (candidate != null) candidate.Dispose();
            if (!IsDisposed)
            {
                selection.Enabled = true;
                UpdateButtons();
            }
        }
    }

    internal static async Task<string> GeneratePreview(string[] sources, string previewDirectory)
    {
        if (!File.Exists(tracker))
            throw new FileNotFoundException("Extract combat-sheet.exe into the same folder as the launcher.");
        // Double trailing separators so they cannot escape the closing quote.
        string arguments = string.Join(" ", new[] { previewDirectory }.Concat(sources).Select(
            path => "\"" + path + new string('\\', path.Length - path.TrimEnd('\\').Length) + "\""));
        using (var process = Process.Start(new ProcessStartInfo(tracker, "--preview-dir " + arguments)
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        }))
        {
            Task<string> output = process.StandardOutput.ReadToEndAsync();
            Task<string> errors = process.StandardError.ReadToEndAsync();
            await Task.WhenAll(output, errors);
            process.WaitForExit();
            if (process.ExitCode != 0)
                throw new InvalidOperationException(errors.Result.Trim());
            return output.Result.TrimEnd('\r', '\n');
        }
    }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

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
    private readonly NotifyIcon tray = new NotifyIcon { Text = "Aurora Combat Tracker", Icon = SystemIcons.Application };
    private string SettingsPath { get { return Path.Combine(appData, "last-import.txt"); } }

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using (var launcher = new TrackerLauncher())
            Application.Run(launcher);
    }

    private TrackerLauncher()
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
        trayMenu.Items.Add("Open launcher", null, delegate { Show(); Activate(); });
        trayMenu.Items.Add("Exit refresh service", null, delegate { Close(); });
        tray.ContextMenuStrip = trayMenu;
        tray.DoubleClick += delegate { Show(); Activate(); };
        FormClosed += delegate {
            if (bridge != null) bridge.Dispose();
            if (party != null) party.Dispose();
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
        try {
            var options = PartySession.Choose(this, mode, characterPath);
            if (options == null) return;
            selection.Enabled = false;
            UpdateButtons();
            status.Text = "Connecting party...";
            candidate = await PartySession.Start(options);
            if (IsDisposed) return;
            if (candidate.Role == "dm") {
                candidate.OpenLobby(Path.Combine(appData, "Previews"));
                if (bridge != null) bridge.Dispose();
                bridge = null;
                tray.Visible = true;
                Hide();
            } else if (!await OpenSheet(candidate)) return;
            if (party != null) party.Dispose();
            party = candidate;
            candidate = null;
        } catch (Exception error) {
            if (!IsDisposed) MessageBox.Show(this, error.Message, "Could not open party", MessageBoxButtons.OK, MessageBoxIcon.Error);
        } finally {
            if (candidate != null) candidate.Dispose();
            if (!IsDisposed) {
                selection.Enabled = true;
                UpdateButtons();
                status.Text = "";
            }
        }
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
            Process.Start(new ProcessStartInfo(preview) { UseShellExecute = true });
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

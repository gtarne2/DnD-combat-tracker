# Aurora Combat Tracker for Mac (players)

This app lets a player on a Mac open their Aurora character sheet and join the DM's party.
The DM still hosts from the Windows app. Hosting a room from a Mac is not supported.

## What you need

- A Mac with macOS 11 (Big Sur) or later. Apple silicon and Intel both work.
- Google Chrome (recommended). The sheet opens in Chrome when it is installed. Safari is used
  otherwise, and has not been tested.
- Your character's Aurora save (`.dnd5e`), and the Aurora content folder it was built with.
  Aurora itself only runs on Windows, so copy these from a PC that has Aurora:
  the save is usually in `Documents\5e Character Builder`, and the content is the
  `custom` folder next to it. Copy the whole folder.
- The same Wi-Fi network as the DM's PC.

## Install and first launch

1. Unzip `Aurora Combat Tracker.app` and drag it to your Applications folder.
2. Double-click it. The app is not signed by Apple, so macOS says it "cannot be opened" or that
   Apple "cannot check it for malicious software". Click **Done** or **OK** (not Move to Trash).
3. Allow it once:
   - **macOS 15 (Sequoia) and later:** open **System Settings → Privacy & Security**, scroll down
     to the message about Aurora Combat Tracker, and click **Open Anyway**. Then open the app
     again and click **Open Anyway** once more.
   - **macOS 14 (Sonoma) and earlier:** Control-click (or right-click) the app, choose **Open**,
     then click **Open** in the dialog.

   Alternatively, in Terminal: `xattr -dr com.apple.quarantine "/Applications/Aurora Combat Tracker.app"`

macOS remembers this, so later launches open normally. A new version of the app needs the same
step once.

## Joining a party

1. Open the app. Choose your `.dnd5e` save, then **Choose folder…** for your content folder
   (you can add more than one, in Aurora's load order). The app remembers these next time.
2. Choose **Join a party**, check your display name, and paste the invitation the DM copied
   from their dashboard (send it over Discord, text or email).
3. Your sheet opens in the browser and connects to the DM. The app has no window of its own:
   it keeps running in the background while the sheet is open, and quits by itself about five
   minutes after you close the sheet.

Next session, open the app and choose **Rejoin last party** to return to the same room without
a new invitation. **Play solo** opens the sheet without a party.

To pick up changes to your character, copy the new `.dnd5e` over the old file, then use
**Session → Refresh from Aurora** on the sheet.

## If something goes wrong

- **"Could not connect" / stays on Reconnecting:** check you are on the same Wi-Fi as the DM, and
  that the DM's Windows firewall allows the Aurora party helper (other players on PCs need the
  same).
- **"Invalid invitation" or "Incompatible party version":** ask the DM for a fresh invitation,
  and make sure your Mac app and the DM's Windows app come from the same build.
- Errors also go to `~/Library/Application Support/Aurora Combat Tracker/player-service.log`.
- Your party bindings, previews and settings live in
  `~/Library/Application Support/Aurora Combat Tracker`. Unlike Windows, macOS has no DPAPI
  here, so the party binding file is protected by file permissions (only your user can read it).

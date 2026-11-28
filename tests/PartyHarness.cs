// Run the launcher's native session and refresh components with isolated fixture inputs.
using System;
using System.IO;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
internal class PartyHarness {
    static int Main(string[] args) {
        try { Run(args).GetAwaiter().GetResult(); return 0; }
        catch(Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
    static async Task Run(string[] args) {
        var serializer=new JavaScriptSerializer();
        var options=serializer.DeserializeObject(Console.ReadLine());
        using(var party=await PartySession.Start(options))
        {
            if (party.Role == "dm") {
                var directory=Environment.GetEnvironmentVariable("LOCALAPPDATA");
                using(var lobby=new RefreshBridge(directory,null)) {
                    var preview=party.WriteLobby(directory,lobby.Url);
                    lobby.TrackLobby(preview);
                    Console.WriteLine(serializer.Serialize(new {url=party.Url,preview,refresh=lobby.Url}));
                    Console.ReadLine();
                }
                return;
            }
            using(var bridge=new RefreshBridge(Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA"),"Aurora Combat Tracker","Previews"),
                directory=>TrackerLauncher.GeneratePreview(args,directory),party.Url)) {
                var preview=await bridge.Open();
                Console.WriteLine(serializer.Serialize(new {url=party.Url,preview,refresh=bridge.Url}));
                Console.ReadLine();
            }
        }
    }
}

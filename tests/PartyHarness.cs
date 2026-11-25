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
        using(var bridge=new RefreshBridge(Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA"),"Aurora Combat Tracker","Previews"),
            directory=>TrackerLauncher.GeneratePreview(args,directory),party.Url)) {
            var preview=party.Role=="dm" ? party.WriteLobby(Environment.GetEnvironmentVariable("LOCALAPPDATA")) : await bridge.Open();
            Console.WriteLine(serializer.Serialize(new {url=party.Url,preview=preview}));
            Console.ReadLine();
        }
    }
}

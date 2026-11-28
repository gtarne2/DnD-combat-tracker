const {buildSrdPack} = require("./build-srd-pack.cjs");

buildSrdPack({
  folder:"srd51", edition:"2014", version:"5.1",
  sectionInfo:{
    monsters:{name:"Monsters",count:201},
    creatures:{name:"Appendix MM-A — Miscellaneous Creatures",count:95},
    npcs:{name:"Appendix MM-B — Nonplayer Characters",count:21}
  },
  officialAttribution:"This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode."
});

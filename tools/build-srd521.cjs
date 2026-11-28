const {buildSrdPack} = require("./build-srd-pack.cjs");

buildSrdPack({
  folder:"srd521", edition:"2024", version:"5.2.1",
  sectionInfo:{
    monsters:{name:"Monsters A–Z",count:235},
    animals:{name:"Animals",count:95}
  },
  officialAttribution:"This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode."
});

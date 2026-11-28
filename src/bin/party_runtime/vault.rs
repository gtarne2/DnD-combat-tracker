use super::{Error, Saved};
use rusqlite::{Connection, OptionalExtension, params};
use std::path::{Path, PathBuf};
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    },
};

fn protect(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>, Error> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len().try_into()?,
        pbData: bytes.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // DPAPI owns the returned allocation. Copy it before releasing it with LocalFree.
    unsafe {
        let ok = if encrypt {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData.cast());
        Ok(result)
    }
}

#[derive(Clone)]
pub struct Vault {
    path: PathBuf,
    profile: String,
}

impl Vault {
    pub fn new(directory: &Path, profile: String) -> Result<Self, Error> {
        let vault = Self {
            path: directory.join("party-bindings.sqlite3"),
            profile,
        };
        vault.open()?.execute_batch(
            "CREATE TABLE IF NOT EXISTS bindings(
            profile TEXT NOT NULL, room TEXT NOT NULL, binding TEXT NOT NULL,
            status TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(profile,room,binding))",
        )?;
        Ok(vault)
    }
    fn open(&self) -> Result<Connection, Error> {
        Ok(Connection::open(&self.path)?)
    }
    pub fn load(&self, room: Option<uuid::Uuid>) -> Result<Option<Saved>, Error> {
        let blob: Option<Vec<u8>> = self
            .open()?
            .query_row(
                "SELECT data FROM bindings WHERE profile=? AND
             ((?2 IS NULL AND status='active') OR (room=?2 AND status!='retired'))
             ORDER BY rowid DESC LIMIT 1",
                params![self.profile, room.map(|r| r.to_string())],
                |r| r.get(0),
            )
            .optional()?;
        blob.map(|b| Ok(serde_json::from_slice(&protect(&b, false)?)?))
            .transpose()
    }
    pub fn save(&self, saved: &Saved) -> Result<(), Error> {
        self.write(saved, "active")
    }
    pub fn pending(&self, saved: &Saved) -> Result<(), Error> {
        self.write(saved, "pending")
    }
    fn write(&self, saved: &Saved, status: &str) -> Result<(), Error> {
        let blob = protect(&serde_json::to_vec(saved)?, true)?;
        self.open()?.execute(
            "INSERT OR REPLACE INTO bindings(profile,room,binding,status,data) VALUES(?,?,?,?,?)",
            params![
                self.profile,
                saved.invite.room.to_string(),
                saved.join_id.to_string(),
                status,
                blob
            ],
        )?;
        Ok(())
    }
    pub fn retire(&self, room: uuid::Uuid, binding: uuid::Uuid) -> Result<(), Error> {
        self.open()?.execute(
            "UPDATE bindings SET status='retired' WHERE profile=? AND room=? AND binding=?",
            params![self.profile, room.to_string(), binding.to_string()],
        )?;
        Ok(())
    }
}

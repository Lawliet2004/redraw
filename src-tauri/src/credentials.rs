#[tauri::command]
pub fn credentials_available() -> bool {
    cfg!(desktop)
}

#[cfg(desktop)]
fn entry(id: &str) -> Result<keyring::Entry, String> {
    if id.len() != 36 || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("Invalid credential reference".into());
    }
    keyring::Entry::new("Redraw.AI", id).map_err(|_| "Credential storage unavailable".into())
}

fn write_credential_sync(id: String, secret: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        entry(&id)?
            .set_password(&secret)
            .map_err(|_| "Could not protect the API key. Check your system keychain.".into())
    }
    #[cfg(mobile)]
    {
        let _ = (id, secret);
        Err("Persistent credentials are unavailable on this device".into())
    }
}

fn read_credential_sync(id: String) -> Result<String, String> {
    #[cfg(desktop)]
    {
        entry(&id)?.get_password().map_err(|_| {
            "Could not read the saved API key. Open AI settings and enter it again.".into()
        })
    }
    #[cfg(mobile)]
    {
        let _ = id;
        Ok(String::new())
    }
}

fn delete_credential_sync(id: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        match entry(&id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Could not remove the previous API key".into()),
        }
    }
    #[cfg(mobile)]
    {
        let _ = id;
        Ok(())
    }
}

#[tauri::command]
pub async fn write_credential(id: String, secret: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_credential_sync(id, secret))
        .await
        .map_err(|_| "Credential operation failed".to_string())?
}

#[tauri::command]
pub async fn read_credential(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_credential_sync(id))
        .await
        .map_err(|_| "Credential operation failed".to_string())?
}

#[tauri::command]
pub async fn delete_credential(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_credential_sync(id))
        .await
        .map_err(|_| "Credential operation failed".to_string())?
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn protected_credential_roundtrip() {
        // Dedicated test entry, removed even if a read fails.
        let id = "ebca50d9-61ad-40ba-a26f-96eb98e84cb0".to_string();
        write_credential_sync(id.clone(), "redraw-test-only".to_string()).unwrap();
        let loaded = read_credential_sync(id.clone());
        delete_credential_sync(id.clone()).unwrap();
        assert_eq!(loaded.unwrap(), "redraw-test-only");
        assert!(read_credential_sync(id).is_err());
    }

    #[test]
    fn rejects_invalid_credential_references() {
        assert!(read_credential_sync("another-application".into()).is_err());
    }
}

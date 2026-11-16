use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Hard ceiling on a scene file we are willing to read into memory.
///
/// A `.playstage` scene is plain JSON describing primitives, so even a very
/// busy scene lands well under a megabyte. The cap exists so that pointing
/// Open at a multi-gigabyte file by mistake fails fast with a message instead
/// of trying to allocate it.
const MAX_SCENE_BYTES: u64 = 64 * 1024 * 1024;

/// Hard ceiling on a single texture image.
///
/// Textures here are flat surface detail -- brick, siding, asphalt -- not
/// photographic plates, so anything past a few megabytes is already far more
/// resolution than a drawn-over panel can show. The cap stops a 200 MP scan
/// dragged in by mistake from stalling the webview mid-decode.
const MAX_IMAGE_BYTES: u64 = 32 * 1024 * 1024;

/// Image formats the webview can decode on every platform we ship to.
///
/// Checked here rather than trusting the dialog's filter: the filter is a
/// convenience for the user, not a guarantee, and a path can also arrive from
/// a scene file written on another machine.
const IMAGE_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "bmp"];

/// Turns any io error into a string the frontend can show the user.
///
/// Tauri commands have to return a serialisable error, and `io::Error` is not.
/// Including the path matters: "permission denied" on its own is useless when
/// the user is trying to work out which folder refused them.
fn describe(path: &Path, err: &std::io::Error) -> String {
    format!("{}: {}", path.display(), err)
}

/// Reads a UTF-8 text file chosen by the user.
///
/// Scoped deliberately narrowly: the frontend may only ask for a path the user
/// just picked in a native dialog. There is no directory listing command and
/// no glob, so this cannot be walked outward into the filesystem.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);

    let meta = fs::metadata(&path).map_err(|e| describe(&path, &e))?;
    if !meta.is_file() {
        return Err(format!("{}: not a file", path.display()));
    }
    if meta.len() > MAX_SCENE_BYTES {
        return Err(format!(
            "{}: file is {:.1} MB, which is larger than Playstage will open",
            path.display(),
            meta.len() as f64 / (1024.0 * 1024.0)
        ));
    }

    fs::read_to_string(&path).map_err(|e| describe(&path, &e))
}

/// Writes text to a path, atomically.
///
/// The write goes to a sibling temp file which is then renamed over the
/// target. The rename is atomic on every platform we ship to, so a crash or a
/// full disk midway through leaves the previous version of the scene intact
/// rather than a half-written file. Overwriting in place does not give that
/// guarantee, and losing a saved scene to a failed save is exactly the failure
/// this phase exists to prevent.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let path = PathBuf::from(path);

    let parent = path
        .parent()
        .ok_or_else(|| format!("{}: has no parent directory", path.display()))?;

    // A temp name beside the target, so the rename stays on one volume.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("scene"),
        stamp
    ));

    {
        let mut file = fs::File::create(&temp).map_err(|e| describe(&temp, &e))?;
        file.write_all(contents.as_bytes())
            .map_err(|e| describe(&temp, &e))?;
        // Flush to the device before the rename, so the rename cannot publish
        // a file whose contents are still sitting in a buffer.
        file.sync_all().map_err(|e| describe(&temp, &e))?;
    }

    fs::rename(&temp, &path).map_err(|e| {
        // Best effort: don't leave litter next to the user's scene.
        let _ = fs::remove_file(&temp);
        describe(&path, &e)
    })
}

/// Reads an image file as raw bytes, for import as a texture.
///
/// Returns `tauri::ipc::Response` rather than `Vec<u8>`. A plain `Vec<u8>`
/// crosses the IPC boundary as a JSON array of decimal numbers -- roughly four
/// characters per byte, parsed one at a time -- which turns a 4 MB PNG into a
/// 16 MB string and a visible stall. `Response` sends the bytes raw and the
/// frontend receives an ArrayBuffer.
///
/// Scoped as narrowly as the two text commands above: one path, which the user
/// either just picked in a native dialog or which came from the scene file
/// they opened. Nothing here can list a directory or walk outward.
#[tauri::command]
fn read_image_file(path: String) -> Result<tauri::ipc::Response, String> {
    let path = PathBuf::from(path);

    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!(
            "{}: not an image Playstage can read (expected {})",
            path.display(),
            IMAGE_EXTENSIONS.join(", ")
        ));
    }

    let meta = fs::metadata(&path).map_err(|e| describe(&path, &e))?;
    if !meta.is_file() {
        return Err(format!("{}: not a file", path.display()));
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(format!(
            "{}: image is {:.1} MB, which is larger than Playstage will load",
            path.display(),
            meta.len() as f64 / (1024.0 * 1024.0)
        ));
    }

    let bytes = fs::read(&path).map_err(|e| describe(&path, &e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            read_image_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

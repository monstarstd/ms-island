use std::path::Path;
use windows::core::{implement, Error, HRESULT, HSTRING, PCWSTR};
use windows::Win32::Foundation::{
    BOOL, DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, HWND, S_OK,
};
use windows::Win32::System::Com::IDataObject;
use windows::Win32::System::Ole::{
    DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, DROPEFFECT, DROPEFFECT_COPY,
    DROPEFFECT_LINK,
};
use windows::Win32::System::SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{ILFree, IShellFolder, SHBindToParent, SHParseDisplayName};

#[implement(IDropSource)]
struct NativeDropSource;

impl IDropSource_Impl for NativeDropSource_Impl {
    fn QueryContinueDrag(
        &self,
        fescapepressed: BOOL,
        grfkeystate: MODIFIERKEYS_FLAGS,
    ) -> HRESULT {
        if fescapepressed.as_bool() {
            return DRAGDROP_S_CANCEL;
        }
        if (grfkeystate.0 & MK_LBUTTON.0) == 0 {
            return DRAGDROP_S_DROP;
        }
        S_OK
    }

    fn GiveFeedback(&self, _dweffect: DROPEFFECT) -> HRESULT {
        DRAGDROP_S_USEDEFAULTCURSORS
    }
}

/// Initiates a native Windows Explorer OLE DoDragDrop operation for a file/folder path.
/// MUST be called on an STA UI thread (e.g. via `app.run_on_main_thread`).
/// Compatible with Brave, Chrome, Edge, WhatsApp Web, Discord, Figma, Gmail, and File Explorer.
pub fn start_native_file_drag(path_str: &str) -> Result<bool, String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err("File no longer exists on disk".to_string());
    }

    let abs_path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    // Strip Windows extended-length prefix \\?\ which confuses SHParseDisplayName
    let clean_str = abs_path
        .to_string_lossy()
        .trim_start_matches("\\\\?\\")
        .to_string();

    unsafe {
        let _ = OleInitialize(None);

        let wide_path = HSTRING::from(&clean_str);
        let mut full_pidl: *mut ITEMIDLIST = std::ptr::null_mut();

        SHParseDisplayName(PCWSTR(wide_path.as_ptr()), None, &mut full_pidl, 0, None)
            .map_err(|e: Error| format!("SHParseDisplayName failed: {}", e))?;

        if full_pidl.is_null() {
            return Err("Could not resolve shell item for file".to_string());
        }

        let mut child_pidl: *mut ITEMIDLIST = std::ptr::null_mut();
        let parent_folder_res: windows::core::Result<IShellFolder> =
            SHBindToParent(full_pidl, Some(&mut child_pidl));

        let drag_result = match parent_folder_res {
            Ok(parent_folder) if !child_pidl.is_null() => {
                let child_slice = [child_pidl as *const ITEMIDLIST];
                match parent_folder.GetUIObjectOf::<_, IDataObject>(HWND::default(), &child_slice, None) {
                    Ok(data_object) => {
                        let drop_source: IDropSource = NativeDropSource.into();
                        let mut effect = DROPEFFECT(0);
                        let hr = DoDragDrop(
                            &data_object,
                            &drop_source,
                            DROPEFFECT(DROPEFFECT_COPY.0 | DROPEFFECT_LINK.0),
                            &mut effect,
                        );
                        Ok(hr == DRAGDROP_S_DROP)
                    }
                    Err(e) => Err(format!("GetUIObjectOf(IDataObject) failed: {}", e)),
                }
            }
            Ok(_) => Err("Failed to obtain child PIDL".to_string()),
            Err(e) => Err(format!("SHBindToParent failed: {}", e)),
        };

        ILFree(Some(full_pidl));
        drag_result
    }
}

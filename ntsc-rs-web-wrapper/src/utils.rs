use std::cell::RefCell;

use wasm_bindgen::prelude::*;
use web_sys::js_sys;

thread_local! {
    static PANIC_CALLBACK: RefCell<Option<js_sys::Function>> = const { RefCell::new(None) };
}

#[wasm_bindgen(js_name = setPanicHook)]
pub fn set_panic_hook(callback: js_sys::Function) {
    PANIC_CALLBACK.with(|cb| {
        *cb.borrow_mut() = Some(callback);
    });

    std::panic::set_hook(Box::new(|info| {
        let msg = info.to_string();
        PANIC_CALLBACK.with(|cb| {
            if let Some(callback) = cb.borrow().as_ref() {
                let _ = callback.call1(&JsValue::NULL, &JsValue::from_str(&msg));
            }
        });
    }));
}

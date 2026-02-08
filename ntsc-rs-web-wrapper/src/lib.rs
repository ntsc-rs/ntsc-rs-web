mod rotate;
mod settings;
mod utils;

extern crate alloc;

use fast_image_resize::{
    FilterType, ResizeAlg, ResizeOptions, Resizer, SrcCropping,
    images::{TypedCroppedImageMut, TypedImage},
    pixels::U8x4,
};
use ntscrs::{
    NtscEffect, NtscEffectFullSettings,
    yiq_fielding::{BlitInfo, DeinterlaceMode, PixelFormat, Rect, Rgbx, YiqView, pixel_bytes_for},
};

use wasm_bindgen::prelude::*;

//pub use wasm_bindgen_rayon::init_thread_pool;
use web_sys::js_sys::Uint8Array;

use crate::rotate::Rotation;

#[allow(unused_macros)]
macro_rules! console_log {
    ($($t:tt)*) => (::web_sys::console::log_1(&format_args!($($t)*).to_string().into()))
}

#[wasm_bindgen]
pub struct NtscConfigurator(NtscEffectFullSettings);

#[wasm_bindgen]
impl NtscConfigurator {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self(NtscEffectFullSettings::default())
    }
}

#[wasm_bindgen]
#[derive(Default)]
pub struct NtscEffectBuf {
    effect: NtscEffect,
    resizer: Resizer,
    src: Box<[u8]>,
    effect_buf: Box<[f32]>,
    resize_dst: Box<[u8]>,
    rotate_dst: Box<[u8]>,
    effect_dst: Box<[u8]>,
    input_dimensions: (usize, usize),
}

#[wasm_bindgen]
pub enum ResizeFilter {
    Nearest,
    Bilinear,
    Bicubic,
}

fn maybe_resize<T: Default + Copy>(buf: &mut Box<[T]>, new_len: usize) {
    if buf.len() != new_len {
        *buf = vec![T::default(); new_len].into_boxed_slice();
    }
}

#[wasm_bindgen]
pub struct EffectOutput {
    pub ptr: *const u8,
    pub len: usize,
    pub width: usize,
    pub height: usize,
}

#[wasm_bindgen]
impl NtscEffectBuf {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Default::default()
    }

    /// Update the effect settings.
    #[wasm_bindgen(js_name = "setEffectSettings")]
    pub fn set_effect_settings(&mut self, settings: NtscConfigurator) {
        self.effect = settings.0.into();
    }

    /// Get a pointer to the input/source buffer. This is what the effect will read from, and what you should write to.
    #[wasm_bindgen(js_name = "inputBuffer")]
    pub fn input_buffer(&mut self, width: usize, height: usize) -> Uint8Array {
        let new_len = width * height * 4;
        maybe_resize(&mut self.src, new_len);
        self.input_dimensions = (width, height);
        unsafe { Uint8Array::view_mut_raw(self.src.as_mut_ptr(), self.src.len()) }
    }

    /// Apply the effect in-place on the contents of the source buffer, writing to and returning the destination buffer.
    #[wasm_bindgen(js_name = "applyEffect")]
    pub fn apply_effect(
        &mut self,
        frame_num: usize,
        dst_width: usize,
        dst_height: usize,
        resize_filter: ResizeFilter,
        pad_to_even: bool,
        effect_enabled: bool,
        rect_top: u32,
        rect_right: u32,
        rect_bottom: u32,
        rect_left: u32,
    ) -> Result<EffectOutput, String> {
        // Resize the output buffer
        const BYTES_PER_PIXEL: usize = pixel_bytes_for::<Rgbx, u8>();

        let (dst_width_padded, dst_height_padded) = if pad_to_even {
            (dst_width.div_ceil(2) * 2, dst_height.div_ceil(2) * 2)
        } else {
            (dst_width, dst_height)
        };
        let new_dst_len = dst_width_padded * dst_height_padded * BYTES_PER_PIXEL;
        maybe_resize(&mut self.effect_dst, new_dst_len);

        let buffers_same_size = self.input_dimensions == (dst_width, dst_height);
        // Update the size of the intermediate buffer used for resizing
        if buffers_same_size {
            maybe_resize(&mut self.resize_dst, 0);
        } else {
            maybe_resize(
                &mut self.resize_dst,
                dst_width * dst_height * BYTES_PER_PIXEL,
            );
        }

        let (resize_dst, resize_dst_dimensions) = if effect_enabled {
            (&mut self.resize_dst, (dst_width as u32, dst_height as u32))
        } else {
            (
                &mut self.effect_dst,
                (dst_width_padded as u32, dst_height_padded as u32),
            )
        };

        let effect_src = if buffers_same_size {
            &self.src
        } else {
            let resize_alg = match resize_filter {
                ResizeFilter::Nearest => ResizeAlg::Nearest,
                ResizeFilter::Bilinear => ResizeAlg::Convolution(FilterType::Bilinear),
                ResizeFilter::Bicubic => ResizeAlg::Convolution(FilterType::CatmullRom),
            };
            let resize_options = ResizeOptions {
                algorithm: resize_alg,
                cropping: SrcCropping::None,
                mul_div_alpha: false,
            };

            let src_image = TypedImage::<'_, U8x4>::from_buffer(
                self.input_dimensions.0 as u32,
                self.input_dimensions.1 as u32,
                &mut self.src,
            )
            .map_err(|e| e.to_string())?;
            let mut dst_image = TypedImage::<'_, U8x4>::from_buffer(
                resize_dst_dimensions.0,
                resize_dst_dimensions.1,
                resize_dst,
            )
            .map_err(|e| e.to_string())?;

            if dst_width_padded != dst_width || dst_height_padded != dst_height {
                let mut cropped_dst_image =
                    TypedCroppedImageMut::new(dst_image, 0, 0, dst_width as u32, dst_height as u32)
                        .map_err(|e| e.to_string())?;
                self.resizer
                    .resize_typed(&src_image, &mut cropped_dst_image, &resize_options)
                    .map_err(|e| e.to_string())?;
            } else {
                self.resizer
                    .resize_typed(&src_image, &mut dst_image, &resize_options)
                    .map_err(|e| e.to_string())?;
            }
            &self.resize_dst
        };

        if effect_enabled {
            let new_yiq_len =
                YiqView::max_buf_length_for((dst_width, dst_height), self.effect.use_field);
            maybe_resize(&mut self.effect_buf, new_yiq_len);

            let mut view = YiqView::from_parts(
                &mut self.effect_buf,
                (dst_width, dst_height),
                self.effect.use_field.to_yiq_field(frame_num),
            );
            view.set_from_strided_buffer::<Rgbx, u8, _>(
                effect_src,
                BlitInfo::from_full_frame(dst_width, dst_height, dst_width * BYTES_PER_PIXEL),
                (),
            );
            self.effect
                .apply_effect_to_yiq(&mut view, frame_num, [1.0, 1.0]);

            // The padded dimensions may not be the same as the un-padded ones
            let dst_rect = Rect::new(
                rect_top as usize,
                rect_left as usize,
                rect_bottom as usize,
                rect_right as usize,
            );

            // If we're not filling in the entire destination frame with the applied effect, we're doing a split-screen
            // and need to copy the post-resize, pre-effect frame "behind" it. This doesn't handle padding to even
            // dimensions, but those two code paths should never overlap (we pad when rendering, but only use
            // split-screen mode in the preview).
            if dst_rect.left != 0
                || dst_rect.top != 0
                || dst_rect.right != dst_width
                || dst_rect.bottom != dst_height
            {
                self.effect_dst.copy_from_slice(effect_src);
            }
            let dst_blit_info = BlitInfo {
                rect: dst_rect,
                destination: (dst_rect.left, dst_rect.top),
                row_bytes: dst_width_padded * 4,
                other_buffer_height: dst_height_padded,
                flip_y: false,
            };

            view.write_to_strided_buffer::<Rgbx, u8, _>(
                &mut self.effect_dst,
                dst_blit_info,
                DeinterlaceMode::Bob,
                (),
            );
        } else {
            maybe_resize(&mut self.effect_buf, 0);

            if buffers_same_size {
                // The effect itself is disabled and we're not doing any resizing. We need to directly copy
                // the buffer.
                if dst_width_padded != dst_width {
                    // Leave room for padding.
                    for (dst, src) in self
                        .effect_dst
                        .chunks_exact_mut(dst_width_padded * BYTES_PER_PIXEL)
                        .zip(self.src.chunks_exact(dst_width * BYTES_PER_PIXEL))
                    {
                        dst[..dst_width * BYTES_PER_PIXEL].copy_from_slice(src);
                    }
                } else {
                    self.effect_dst[..self.src.len()].copy_from_slice(&self.src);
                }
            }
        }

        if dst_width_padded != dst_width {
            for row in self
                .effect_dst
                .chunks_exact_mut(dst_width_padded * BYTES_PER_PIXEL)
            {
                let (written, remainder) = row.split_at_mut(dst_width * BYTES_PER_PIXEL);
                remainder.copy_from_slice(&written[written.len() - Rgbx::NUM_COMPONENTS..]);
            }
        }
        if dst_height_padded != dst_height {
            let last_dst_rows =
                &mut self.effect_dst[(dst_width_padded * BYTES_PER_PIXEL) * (dst_height_padded - 2)..];
            let (second_last_dst_row, last_dst_row) =
                last_dst_rows.split_at_mut(dst_width_padded * BYTES_PER_PIXEL);
            last_dst_row.copy_from_slice(second_last_dst_row);
        }

        Ok(EffectOutput {
            ptr: self.effect_dst.as_ptr(),
            len: self.effect_dst.len(),
            width: dst_width_padded,
            height: dst_height_padded,
        })
    }
}

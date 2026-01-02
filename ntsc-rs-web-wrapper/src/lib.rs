mod settings;
mod utils;

extern crate alloc;

use fast_image_resize::{
    images::{CroppedImageMut, Image},
    FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer, SrcCropping,
};
use ntscrs::{
    yiq_fielding::{pixel_bytes_for, BlitInfo, DeinterlaceMode, PixelFormat, Rect, Rgbx, YiqView},
    NtscEffect, NtscEffectFullSettings,
};

use wasm_bindgen::prelude::*;

//pub use wasm_bindgen_rayon::init_thread_pool;
use web_sys::js_sys::Uint8Array;

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

    pub fn apply(
        &self,
        width: usize,
        height: usize,
        src: &[u8],
        intermediate: &mut [f32],
        dst: &mut [u8],
        frame_num: usize,
    ) {
        let mut view = YiqView::from_parts(
            intermediate,
            (width, height),
            self.0.use_field.to_yiq_field(frame_num),
        );
        view.set_from_strided_buffer::<Rgbx, u8, _>(
            src,
            BlitInfo::from_full_frame(width, height, width * 4),
            (),
        );
        NtscEffect::from(&self.0).apply_effect_to_yiq(&mut view, frame_num, [1.0, 1.0]);
        view.write_to_strided_buffer::<Rgbx, u8, _>(
            dst,
            BlitInfo::from_full_frame(width, height, width * 4),
            DeinterlaceMode::Bob,
            (),
        );
    }

    pub fn buf_length_for(&self, width: usize, height: usize, frame_num: usize) -> usize {
        YiqView::buf_length_for((width, height), self.0.use_field.to_yiq_field(frame_num))
    }
}

#[wasm_bindgen]
#[derive(Default)]
pub struct NtscEffectBuf {
    effect: NtscEffect,
    src: Box<[u8]>,
    intermediate: Box<[f32]>,
    resizer: Resizer,
    resize_buf: Box<[u8]>,
    dst: Box<[u8]>,
    input_dimensions: (usize, usize),
}

#[wasm_bindgen]
pub enum ResizeFilter {
    Nearest,
    Bilinear,
    Bicubic,
}

fn maybe_resize<T: Default + Copy>(buf: &mut Box<[T]>, new_len: usize) {
    if buf.len() == new_len {
        return;
    }
    *buf = vec![T::default(); new_len].into_boxed_slice();
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
    ) -> Result<Uint8Array, String> {
        // Resize the intermediate and output buffers
        let new_yiq_len =
            YiqView::max_buf_length_for((dst_width, dst_height), self.effect.use_field);
        maybe_resize(&mut self.intermediate, new_yiq_len);
        const BYTES_PER_PIXEL: usize = pixel_bytes_for::<Rgbx, u8>();

        let (dst_width_padded, dst_height_padded) = if pad_to_even {
            (dst_width.div_ceil(2) * 2, dst_height.div_ceil(2) * 2)
        } else {
            (dst_width, dst_height)
        };
        let new_dst_len = dst_width_padded * dst_height_padded * BYTES_PER_PIXEL;
        maybe_resize(&mut self.dst, new_dst_len);

        let buffers_same_size = self.input_dimensions == (dst_width, dst_height);
        // Update the size of the intermediate buffer used for resizing
        if buffers_same_size {
            maybe_resize(&mut self.resize_buf, 0);
        } else {
            maybe_resize(
                &mut self.resize_buf,
                dst_width * dst_height * BYTES_PER_PIXEL,
            );
        }

        let (resize_dst, resize_dst_dimensions) = if effect_enabled {
            (&mut self.resize_buf, (dst_width as u32, dst_height as u32))
        } else {
            (
                &mut self.dst,
                (dst_width_padded as u32, dst_height_padded as u32),
            )
        };
        let src_buf = if buffers_same_size {
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

            let src_image = Image::from_slice_u8(
                self.input_dimensions.0 as u32,
                self.input_dimensions.1 as u32,
                &mut self.src,
                PixelType::U8x4,
            )
            .map_err(|e| e.to_string())?;
            let mut dst_image = Image::from_slice_u8(
                resize_dst_dimensions.0,
                resize_dst_dimensions.1,
                resize_dst,
                PixelType::U8x4,
            )
            .map_err(|e| e.to_string())?;

            if dst_width_padded != dst_width || dst_height_padded != dst_height {
                let mut cropped_dst_image =
                    CroppedImageMut::new(&mut dst_image, 0, 0, dst_width as u32, dst_height as u32)
                        .map_err(|e| e.to_string())?;
                self.resizer
                    .resize(&src_image, &mut cropped_dst_image, &resize_options)
                    .map_err(|e| e.to_string())?;
            } else {
                self.resizer
                    .resize(&src_image, &mut dst_image, &resize_options)
                    .map_err(|e| e.to_string())?;
            }
            &self.resize_buf
        };

        if effect_enabled {
            let mut view = YiqView::from_parts(
                &mut self.intermediate,
                (dst_width, dst_height),
                self.effect.use_field.to_yiq_field(frame_num),
            );
            view.set_from_strided_buffer::<Rgbx, u8, _>(
                src_buf,
                BlitInfo::from_full_frame(dst_width, dst_height, dst_width * BYTES_PER_PIXEL),
                (),
            );
            self.effect
                .apply_effect_to_yiq(&mut view, frame_num, [1.0, 1.0]);

            // The padded dimensions may not be the same as the un-padded ones
            let dst_blit_info = BlitInfo {
                rect: Rect::from_width_height(dst_width, dst_height),
                destination: (0, 0),
                row_bytes: dst_width_padded * 4,
                other_buffer_height: dst_height_padded,
                flip_y: false,
            };

            view.write_to_strided_buffer::<Rgbx, u8, _>(
                &mut self.dst,
                dst_blit_info,
                DeinterlaceMode::Bob,
                (),
            );

            if dst_width_padded != dst_width {
                for row in self
                    .dst
                    .chunks_exact_mut(dst_width_padded * BYTES_PER_PIXEL)
                {
                    let (written, remainder) = row.split_at_mut(dst_width * BYTES_PER_PIXEL);
                    remainder.copy_from_slice(&written[written.len() - Rgbx::NUM_COMPONENTS..]);
                }
            }
        } else if buffers_same_size {
            // The effect itself is disabled and we're not doing any resizing either. We need to directly copy the
            // buffer. We may need to add padding.
            if dst_width_padded != dst_width {
                for (dst, src) in self
                    .dst
                    .chunks_exact_mut(dst_width_padded * BYTES_PER_PIXEL)
                    .zip(self.src.chunks_exact(dst_width * BYTES_PER_PIXEL))
                {
                    dst[..dst_width * BYTES_PER_PIXEL].copy_from_slice(src);
                }
            } else {
                self.dst[..self.src.len()].copy_from_slice(&self.src);
            }
        }

        if dst_width_padded != dst_width {
            for row in self
                .dst
                .chunks_exact_mut(dst_width_padded * BYTES_PER_PIXEL)
            {
                let (written, remainder) = row.split_at_mut(dst_width * BYTES_PER_PIXEL);
                remainder.copy_from_slice(&written[written.len() - Rgbx::NUM_COMPONENTS..]);
            }
        }
        if dst_height_padded != dst_height {
            let last_dst_rows =
                &mut self.dst[(dst_width_padded * BYTES_PER_PIXEL) * (dst_height_padded - 2)..];
            let (second_last_dst_row, last_dst_row) =
                last_dst_rows.split_at_mut(dst_width_padded * BYTES_PER_PIXEL);
            last_dst_row.copy_from_slice(second_last_dst_row);
        }

        Ok(unsafe { Uint8Array::view(&self.dst) })
    }
}

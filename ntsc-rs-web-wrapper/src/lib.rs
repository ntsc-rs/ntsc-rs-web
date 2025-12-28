mod settings;
mod utils;

extern crate alloc;

use fast_image_resize::{
    images::Image, FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer, SrcCropping,
};
use ntscrs::{
    yiq_fielding::{BlitInfo, DeinterlaceMode, Rgbx, YiqView},
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
    resize_options: ResizeOptions,
    resize_buf: Box<[u8]>,
    effect_enabled: bool,
    dst: Box<[u8]>,
    input_dimensions: (usize, usize),
    output_dimensions: (usize, usize),
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

    #[wasm_bindgen(js_name = "setInputSize")]
    pub fn set_input_size(&mut self, width: usize, height: usize) {
        let new_len = width * height * 4;
        maybe_resize(&mut self.src, new_len);
        self.input_dimensions = (width, height);
    }

    #[wasm_bindgen(js_name = "setOutputSize")]
    pub fn set_output_size(&mut self, width: usize, height: usize) {
        let new_len = width * height * 4;
        maybe_resize(&mut self.dst, new_len);
        let new_yiq_len = YiqView::max_buf_length_for((width, height), self.effect.use_field);
        maybe_resize(&mut self.intermediate, new_yiq_len);
        self.output_dimensions = (width, height);

        if self.input_dimensions == self.output_dimensions {
            maybe_resize(&mut self.resize_buf, 0);
        } else {
            maybe_resize(&mut self.resize_buf, new_len);
        }
    }

    /// Update the effect settings.
    #[wasm_bindgen(js_name = "setEffectSettings")]
    pub fn set_effect_settings(&mut self, settings: NtscConfigurator) {
        self.effect = settings.0.into();
    }

    #[wasm_bindgen(js_name = "setResizeFilter")]
    pub fn set_resize_filter(&mut self, filter: ResizeFilter) {
        let resize_alg = match filter {
            ResizeFilter::Nearest => ResizeAlg::Nearest,
            ResizeFilter::Bilinear => ResizeAlg::Convolution(FilterType::Bilinear),
            ResizeFilter::Bicubic => ResizeAlg::Convolution(FilterType::CatmullRom),
        };
        self.resize_options = ResizeOptions {
            algorithm: resize_alg,
            cropping: SrcCropping::None,
            mul_div_alpha: false,
        };
    }

    #[wasm_bindgen(js_name = "setEffectEnabled")]
    pub fn set_effect_enabled(&mut self, enabled: bool) {
        self.effect_enabled = enabled;
    }

    /// Get a pointer to the input/source buffer. This is what the effect will read from, and what you should write to.
    #[wasm_bindgen(js_name = "srcPtr")]
    pub fn src_ptr(&mut self) -> Uint8Array {
        unsafe { Uint8Array::view_mut_raw(self.src.as_mut_ptr(), self.src.len()) }
    }

    /// Get a pointer to the output/destination buffer. This is what the effect will write to, and what you should read
    /// from.
    #[wasm_bindgen(js_name = "dstPtr")]
    pub fn dst_ptr(&self) -> Uint8Array {
        unsafe { Uint8Array::view(&self.dst) }
    }

    /// Apply the effect in-place on the contents of the source buffer, writing to the destination buffer.
    #[wasm_bindgen(js_name = "applyEffect")]
    pub fn apply_effect(&mut self, frame_num: usize) -> Result<(), String> {
        let resize_dst = if self.effect_enabled {
            &mut self.resize_buf
        } else {
            &mut self.dst
        };
        let src_buf = if self.input_dimensions == self.output_dimensions {
            &self.src
        } else {
            let src_image = Image::from_slice_u8(
                self.input_dimensions.0 as u32,
                self.input_dimensions.1 as u32,
                &mut self.src,
                PixelType::U8x4,
            )
            .map_err(|e| e.to_string())?;
            let mut dst_image = Image::from_slice_u8(
                self.output_dimensions.0 as u32,
                self.output_dimensions.1 as u32,
                resize_dst,
                PixelType::U8x4,
            )
            .map_err(|e| e.to_string())?;
            self.resizer
                .resize(&src_image, &mut dst_image, &self.resize_options)
                .map_err(|e| e.to_string())?;
            &self.resize_buf
        };

        if self.effect_enabled {
            let mut view = YiqView::from_parts(
                &mut self.intermediate,
                self.output_dimensions,
                self.effect.use_field.to_yiq_field(frame_num),
            );
            let blit_width = self.output_dimensions.0;
            let blit_height = self.output_dimensions.1;
            view.set_from_strided_buffer::<Rgbx, u8, _>(
                src_buf,
                BlitInfo::from_full_frame(blit_width, blit_height, blit_width * 4),
                (),
            );
            self.effect
                .apply_effect_to_yiq(&mut view, frame_num, [1.0, 1.0]);
            view.write_to_strided_buffer::<Rgbx, u8, _>(
                &mut self.dst,
                BlitInfo::from_full_frame(blit_width, blit_height, blit_width * 4),
                DeinterlaceMode::Bob,
                (),
            );
        } else if self.input_dimensions == self.output_dimensions {
            // The effect itself is disabled and we're not doing any resizing either. We need to directly copy the
            // buffer.
            self.dst.copy_from_slice(&self.src);
        }

        Ok(())
    }
}

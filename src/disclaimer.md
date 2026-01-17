# Web Version Limitations

This is the **experimental** web version of ntsc-rs. It runs entirely in your browser, which makes it convenient, but it comes with some limitations compared to [the desktop version](https://ntsc.rs):

## Video Output

- No interlaced output. The web video encoding APIs don't support interlacing.
- No lossless output codec. Browsers only support lossy video formats.
- Chroma subsampling is always enabled. This reduces the color resolution of the output, which may be noticeable on sharp edges.
- No integration with other video editing software. The desktop version comes in plugin form, and works with a wide variety of video editing software.

## Performance

- Slower effect rendering. The effect itself is around 1.5x as slow as the desktop version.
- Firefox (and possibly Safari) render slower than Chrome. These browsers simply chose a slower video encoding preset, and there is no way to control the encoding speed. Prefer Chrome if possible.

## Mobile

- Rendering in the background **will probably not work!** Mobile browsers aggressively suspend background tabs, which will interrupt any ongoing render. Keep your browser in the foreground while rendering.
- **Videos recorded on phones may not work correctly.** Mobile video files are very weird. The camera rotation is handled separately from the video, most mobile videos have variable framerates, and some videos may simply have invalid metadata. This is a problem even on the desktop version, but it's important to mention because this is the only version that actually runs on a phone.

---

If you have a computer and enjoy using ntsc-rs, you should use the desktop version of ntsc-rs. It's available for Windows, macOS, and Linux, and supports a wider variety of output formats and features. It can also be used as a plugin for video editing software.

<p style="text-align: center;"><a href="https://ntsc.rs/download">Download ntsc-rs for desktop</a></p>

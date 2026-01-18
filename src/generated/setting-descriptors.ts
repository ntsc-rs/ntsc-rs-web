import type {SettingDescriptor} from '../../ntsc-rs-web-wrapper/build/ntsc_rs_web_wrapper';

const SETTING_DESCRIPTORS: SettingDescriptor[] = [
    {
        "label": "Random seed",
        "description": null,
        "id": 36,
        "idName": "random_seed",
        "kind": 2,
        "value": {
            "min": -2147483648,
            "max": 2147483647,
            "defaultValue": 0
        }
    },
    {
        "label": "Use field",
        "description": "Choose which rows (\"fields\" in NTSC parlance) of the source image will be used.",
        "id": 30,
        "idName": "use_field",
        "kind": 0,
        "value": {
            "options": [
                {
                    "label": "Alternating",
                    "description": "Skip every other row, alternating between skipping even and odd rows.",
                    "index": 0
                },
                {
                    "label": "Upper only",
                    "description": "Skip every lower row, keeping the upper ones.",
                    "index": 1
                },
                {
                    "label": "Lower only",
                    "description": "Skip every upper row, keeping the lower ones.",
                    "index": 2
                },
                {
                    "label": "Interleaved (upper first)",
                    "description": "Treat the video as interlaced, with the upper field as the earlier frame.",
                    "index": 4
                },
                {
                    "label": "Interleaved (lower first)",
                    "description": "Treat the video as interlaced, with the lower field as the earlier frame.",
                    "index": 5
                },
                {
                    "label": "Both",
                    "description": "Use all rows; don't skip any.",
                    "index": 3
                }
            ],
            "defaultValue": 4
        }
    },
    {
        "label": "Lowpass filter type",
        "description": "The low-pass filter to use throughout the effect.",
        "id": 46,
        "idName": "filter_type",
        "kind": 0,
        "value": {
            "options": [
                {
                    "label": "Constant K (blurry)",
                    "description": "Simple constant-k filter. Produces longer, blurry results.",
                    "index": 0
                },
                {
                    "label": "Butterworth (sharper)",
                    "description": "Filter with a sharper falloff. Produces sharpened, less blurry results.",
                    "index": 1
                }
            ],
            "defaultValue": 1
        }
    },
    {
        "label": "Input luma filter",
        "description": "Filter the input luminance to decrease rainbow artifacts.",
        "id": 38,
        "idName": "input_luma_filter",
        "kind": 0,
        "value": {
            "options": [
                {
                    "label": "Notch",
                    "description": "Apply a notch filter to the input luminance signal. Sharp, but has ringing artifacts.",
                    "index": 2
                },
                {
                    "label": "Box",
                    "description": "Apply a simple box filter to the input luminance signal.",
                    "index": 1
                },
                {
                    "label": "None",
                    "description": "Do not filter the luminance signal. Adds rainbow artifacts.",
                    "index": 0
                }
            ],
            "defaultValue": 2
        }
    },
    {
        "label": "Chroma low-pass in",
        "description": "Apply a low-pass filter to the input chrominance (color) signal.",
        "id": 0,
        "idName": "chroma_lowpass_in",
        "kind": 0,
        "value": {
            "options": [
                {
                    "label": "Full",
                    "description": "Full-intensity low-pass filter.",
                    "index": 2
                },
                {
                    "label": "Light",
                    "description": "Less intense low-pass filter.",
                    "index": 1
                },
                {
                    "label": "None",
                    "description": "No low-pass filter.",
                    "index": 0
                }
            ],
            "defaultValue": 2
        }
    },
    {
        "label": "Composite signal sharpening",
        "description": "Boost high frequencies in the NTSC signal, sharpening the image and intensifying colors.",
        "id": 1,
        "idName": "composite_preemphasis",
        "kind": 3,
        "value": {
            "min": -1,
            "max": 2,
            "logarithmic": false,
            "defaultValue": 1
        }
    },
    {
        "label": "Composite signal noise",
        "description": "Noise applied to the composite NTSC signal.",
        "id": 52,
        "idName": "composite_noise",
        "kind": 5,
        "value": {
            "children": [
                {
                    "label": "Intensity",
                    "description": "Intensity of the noise.",
                    "id": 4,
                    "idName": "composite_noise_intensity",
                    "kind": 1,
                    "value": {
                        "logarithmic": true,
                        "defaultValue": 0.05
                    }
                },
                {
                    "label": "Frequency",
                    "description": "Base wavelength, in pixels, of the noise.",
                    "id": 53,
                    "idName": "composite_noise_frequency",
                    "kind": 3,
                    "value": {
                        "min": 0,
                        "max": 1,
                        "logarithmic": false,
                        "defaultValue": 0.5
                    }
                },
                {
                    "label": "Detail",
                    "description": "Octaves of noise.",
                    "id": 54,
                    "idName": "composite_noise_detail",
                    "kind": 2,
                    "value": {
                        "min": 1,
                        "max": 5,
                        "defaultValue": 1
                    }
                }
            ],
            "defaultValue": true
        }
    },
    {
        "label": "Snow",
        "description": "Frequency of random speckles in the image.",
        "id": 6,
        "idName": "snow_intensity",
        "kind": 3,
        "value": {
            "min": 0,
            "max": 100,
            "logarithmic": true,
            "defaultValue": 0.00025
        }
    },
    {
        "label": "Snow anisotropy",
        "description": "Determines whether the speckles are placed truly randomly or concentrated in certain rows.",
        "id": 34,
        "idName": "snow_anisotropy",
        "kind": 1,
        "value": {
            "logarithmic": false,
            "defaultValue": 0.5
        }
    },
    {
        "label": "Scanline phase shift",
        "description": "Phase shift of the chrominance (color) signal each scanline. Usually 180 degrees.",
        "id": 2,
        "idName": "video_scanline_phase_shift",
        "kind": 0,
        "value": {
            "options": [
                {
                    "label": "0 degrees",
                    "description": null,
                    "index": 0
                },
                {
                    "label": "90 degrees",
                    "description": null,
                    "index": 1
                },
                {
                    "label": "180 degrees",
                    "description": null,
                    "index": 2
                },
                {
                    "label": "270 degrees",
                    "description": null,
                    "index": 3
                }
            ],
            "defaultValue": 2
        }
    },
    {
        "label": "Scanline phase shift offset",
        "description": null,
        "id": 3,
        "idName": "video_scanline_phase_shift_offset",
        "kind": 2,
        "value": {
            "min": 0,
            "max": 3,
            "defaultValue": 0
        }
    },
    {
        "label": "Chroma demodulation filter",
        "description": "Filter used to modulate the chrominance (color) data out of the composite NTSC signal.",
        "id": 33,
        "idName": "chroma_demodulation",
        "kind": 0,
        "value": {
            "options": [
                {
                    "label": "Box",
                    "description": "Simple horizontal box blur.",
                    "index": 0
                },
                {
                    "label": "Notch",
                    "description": "Notch filter. Sharper than a box blur, but with ringing artifacts.",
                    "index": 1
                },
                {
                    "label": "1-line comb",
                    "description": "Average the current row with the previous one, phase-cancelling the chrominance (color) signals. Only works if the scanline phase shift is 180 degrees.",
                    "index": 2
                },
                {
                    "label": "2-line comb",
                    "description": "Average the current row with the previous and next ones, phase-cancelling the chrominance (color) signals. Only works if the scanline phase shift is 180 degrees.",
                    "index": 3
                }
            ],
            "defaultValue": 1
        }
    },
    {
        "label": "Luma smear",
        "description": null,
        "id": 45,
        "idName": "luma_smear",
        "kind": 3,
        "value": {
            "min": 0,
            "max": 1,
            "logarithmic": false,
            "defaultValue": 0.5
        }
    },
    {
        "label": "Head switching",
        "description": "Emulate VHS head-switching artifacts at the bottom of the image.",
        "id": 11,
        "idName": "head_switching",
        "kind": 5,
        "value": {
            "children": [
                {
                    "label": "Height",
                    "description": "Total height of the head-switching artifact.",
                    "id": 12,
                    "idName": "head_switching_height",
                    "kind": 2,
                    "value": {
                        "min": 0,
                        "max": 24,
                        "defaultValue": 8
                    }
                },
                {
                    "label": "Offset",
                    "description": "How much of the head-switching artifact is off-screen.",
                    "id": 13,
                    "idName": "head_switching_offset",
                    "kind": 2,
                    "value": {
                        "min": 0,
                        "max": 24,
                        "defaultValue": 3
                    }
                },
                {
                    "label": "Horizontal shift",
                    "description": "How much the head-switching artifact shifts rows horizontally.",
                    "id": 14,
                    "idName": "head_switching_horizontal_shift",
                    "kind": 3,
                    "value": {
                        "min": -100,
                        "max": 100,
                        "logarithmic": false,
                        "defaultValue": 72
                    }
                },
                {
                    "label": "Start mid-line",
                    "description": "Start the head-switching artifact mid-scanline, with some static where it begins.",
                    "id": 49,
                    "idName": "head_switching_start_mid_line",
                    "kind": 5,
                    "value": {
                        "children": [
                            {
                                "label": "Position",
                                "description": "Horizontal position at which the head-switching starts.",
                                "id": 50,
                                "idName": "head_switching_mid_line_position",
                                "kind": 1,
                                "value": {
                                    "logarithmic": false,
                                    "defaultValue": 0.95
                                }
                            },
                            {
                                "label": "Jitter",
                                "description": "How much the head-switching artifact \"jitters\" horizontally.",
                                "id": 51,
                                "idName": "head_switching_mid_line_jitter",
                                "kind": 1,
                                "value": {
                                    "logarithmic": true,
                                    "defaultValue": 0.03
                                }
                            }
                        ],
                        "defaultValue": true
                    }
                }
            ],
            "defaultValue": true
        }
    },
    {
        "label": "Tracking noise",
        "description": "Emulate noise from VHS tracking error.",
        "id": 15,
        "idName": "tracking_noise",
        "kind": 5,
        "value": {
            "children": [
                {
                    "label": "Height",
                    "description": "Total height of the tracking artifacts.",
                    "id": 16,
                    "idName": "tracking_noise_height",
                    "kind": 2,
                    "value": {
                        "min": 0,
                        "max": 120,
                        "defaultValue": 12
                    }
                },
                {
                    "label": "Wave intensity",
                    "description": "How much the affected scanlines \"wave\" back and forth.",
                    "id": 17,
                    "idName": "tracking_noise_wave_intensity",
                    "kind": 3,
                    "value": {
                        "min": -50,
                        "max": 50,
                        "logarithmic": false,
                        "defaultValue": 15
                    }
                },
                {
                    "label": "Snow intensity",
                    "description": "Frequency of speckle-type noise in the artifacts.",
                    "id": 18,
                    "idName": "tracking_noise_snow_intensity",
                    "kind": 3,
                    "value": {
                        "min": 0,
                        "max": 1,
                        "logarithmic": true,
                        "defaultValue": 0.025
                    }
                },
                {
                    "label": "Snow anisotropy",
                    "description": "How much the speckles are clustered by scanline.",
                    "id": 35,
                    "idName": "tracking_noise_snow_anisotropy",
                    "kind": 1,
                    "value": {
                        "logarithmic": false,
                        "defaultValue": 0.25
                    }
                },
                {
                    "label": "Noise intensity",
                    "description": "Intensity of non-speckle noise.",
                    "id": 31,
                    "idName": "tracking_noise_noise_intensity",
                    "kind": 1,
                    "value": {
                        "logarithmic": true,
                        "defaultValue": 0.25
                    }
                }
            ],
            "defaultValue": true
        }
    },
    {
        "label": "Ringing",
        "description": "Additional ringing artifacts, simulated with a notch filter.",
        "id": 19,
        "idName": "ringing",
        "kind": 5,
        "value": {
            "children": [
                {
                    "label": "Frequency",
                    "description": "Frequency/period of the ringing, in \"rings per pixel\".",
                    "id": 20,
                    "idName": "ringing_frequency",
                    "kind": 1,
                    "value": {
                        "logarithmic": false,
                        "defaultValue": 0.45
                    }
                },
                {
                    "label": "Power",
                    "description": "The power of the notch filter / how far out the ringing extends.",
                    "id": 21,
                    "idName": "ringing_power",
                    "kind": 3,
                    "value": {
                        "min": 1,
                        "max": 10,
                        "logarithmic": false,
                        "defaultValue": 4
                    }
                },
                {
                    "label": "Scale",
                    "description": "Intensity of the ringing.",
                    "id": 22,
                    "idName": "ringing_scale",
                    "kind": 3,
                    "value": {
                        "min": 0,
                        "max": 10,
                        "logarithmic": false,
                        "defaultValue": 4
                    }
                }
            ],
            "defaultValue": true
        }
    },
    {
        "label": "Luma noise",
        "description": "Noise applied to the luminance signal. Useful for higher-frequency noise than the \"Composite noise\" setting can provide.",
        "id": 55,
        "idName": "luma_noise",
        "kind": 5,
        "value": {
            "children": [
                {
                    "label": "Intensity",
                    "description": "Intensity of the noise.",
                    "id": 57,
                    "idName": "luma_noise_intensity",
                    "kind": 1,
                    "value": {
                        "logarithmic": true,
                        "defaultValue": 0.01
                    }
                },
                {
                    "label": "Frequency",
                    "description": "Base wavelength, in pixels, of the noise.",
                    "id": 56,
                    "idName": "luma_noise_frequency",
                    "kind": 3,
                    "value": {
                        "min": 0,
                        "max": 1,
                        "logarithmic": false,
                        "defaultValue": 0.5
                    }
                },
                {
                    "label": "Detail",
                    "description": "Octaves of noise.",
                    "id": 58,
                    "idName": "luma_noise_detail",
                    "kind": 2,
                    "value": {
                        "min": 1,
                        "max": 5,
                        "defaultValue": 1
                    }
                }
            ],
            "defaultValue": true
        }
    },
    {
        "label": "Chroma noise",
        "description": "Noise applied to the chrominance (color) signal.",
        "id": 42,
        "idName": "chroma_noise",
        "kind": 5,
        "value": {
            "children": [
                {
                    "label": "Intensity",
                    "description": "Intensity of the noise.",
                    "id": 5,
                    "idName": "chroma_noise_intensity",
                    "kind": 1,
                    "value": {
                        "logarithmic": true,
                        "defaultValue": 0.1
                    }
                },
                {
                    "label": "Frequency",
                    "description": "Base wavelength, in pixels, of the noise.",
                    "id": 43,
                    "idName": "chroma_noise_frequency",
                    "kind": 3,
                    "value": {
                        "min": 0,
                        "max": 0.5,
                        "logarithmic": false,
                        "defaultValue": 0.05
                    }
                },
                {
                    "label": "Detail",
                    "description": "Octaves of noise.",
                    "id": 44,
                    "idName": "chroma_noise_detail",
                    "kind": 2,
                    "value": {
                        "min": 1,
                        "max": 5,
                        "defaultValue": 2
                    }
                }
            ],
            "defaultValue": true
        }
    },
    {
        "label": "Chroma phase error",
        "description": "Phase error for the chrominance (color) signal.",
        "id": 37,
        "idName": "chroma_phase_error",
        "kind": 1,
        "value": {
            "logarithmic": false,
            "defaultValue": 0
        }
    },
    {
        "label": "Chroma phase noise",
        "description": "Noise applied per-scanline to the phase of the chrominance (color) signal.",
        "id": 7,
        "idName": "chroma_phase_noise_intensity",
        "kind": 1,
        "value": {
            "logarithmic": true,
            "defaultValue": 0.001
        }
    },
    {
        "label": "Chroma delay (horizontal)",
        "description": "Horizontal offset of the chrominance (color) signal.",
        "id": 8,
        "idName": "chroma_delay_horizontal",
        "kind": 3,
        "value": {
            "min": -40,
            "max": 40,
            "logarithmic": false,
            "defaultValue": 0
        }
    },
    {
        "label": "Chroma delay (vertical)",
        "description": "Vertical offset of the chrominance (color) signal. Usually increases with VHS generation loss.",
        "id": 9,
        "idName": "chroma_delay_vertical",
        "kind": 2,
        "value": {
            "min": -20,
            "max": 20,
            "defaultValue": 0
        }
    },
    {
        "label": "VHS emulation",
        "description": null,
        "id": 23,
        "idName": "vhs_settings",
        "kind": 5,
        "value": {
            "children": [
                {
                    "label": "Tape speed",
                    "description": "Emulate cutoff of high-frequency data at various VHS recording speeds.",
                    "id": 24,
                    "idName": "vhs_tape_speed",
                    "kind": 0,
                    "value": {
                        "options": [
                            {
                                "label": "SP (Standard Play)",
                                "description": null,
                                "index": 1
                            },
                            {
                                "label": "LP (Long Play)",
                                "description": null,
                                "index": 2
                            },
                            {
                                "label": "EP (Extended Play)",
                                "description": null,
                                "index": 3
                            },
                            {
                                "label": "None",
                                "description": null,
                                "index": 0
                            }
                        ],
                        "defaultValue": 2
                    }
                },
                {
                    "label": "Chroma loss",
                    "description": "Chance that the chrominance (color) signal is completely lost in each scanline.",
                    "id": 26,
                    "idName": "vhs_chroma_loss",
                    "kind": 1,
                    "value": {
                        "logarithmic": true,
                        "defaultValue": 0.000025
                    }
                },
                {
                    "label": "Sharpen",
                    "description": "Sharpening of the image, as done by some VHS decks.",
                    "id": 47,
                    "idName": "vhs_sharpen_enabled",
                    "kind": 5,
                    "value": {
                        "children": [
                            {
                                "label": "Intensity",
                                "description": "Amount of sharpening to apply.",
                                "id": 27,
                                "idName": "vhs_sharpen",
                                "kind": 3,
                                "value": {
                                    "min": 0,
                                    "max": 5,
                                    "logarithmic": false,
                                    "defaultValue": 0.25
                                }
                            },
                            {
                                "label": "Frequency",
                                "description": "Frequency / radius of the sharpening, relative to the tape speed's cutoff frequency.",
                                "id": 48,
                                "idName": "vhs_sharpen_frequency",
                                "kind": 3,
                                "value": {
                                    "min": 0.5,
                                    "max": 4,
                                    "logarithmic": false,
                                    "defaultValue": 1
                                }
                            }
                        ],
                        "defaultValue": true
                    }
                },
                {
                    "label": "Edge wave",
                    "description": "Horizontal waving of the image.",
                    "id": 39,
                    "idName": "vhs_edge_wave_enabled",
                    "kind": 5,
                    "value": {
                        "children": [
                            {
                                "label": "Intensity",
                                "description": "Horizontal waving of the image, in pixels.",
                                "id": 28,
                                "idName": "vhs_edge_wave",
                                "kind": 3,
                                "value": {
                                    "min": 0,
                                    "max": 20,
                                    "logarithmic": false,
                                    "defaultValue": 0.5
                                }
                            },
                            {
                                "label": "Speed",
                                "description": "Speed at which the horizontal waving occurs.",
                                "id": 29,
                                "idName": "vhs_edge_wave_speed",
                                "kind": 3,
                                "value": {
                                    "min": 0,
                                    "max": 10,
                                    "logarithmic": false,
                                    "defaultValue": 4
                                }
                            },
                            {
                                "label": "Frequency",
                                "description": "Base wavelength for the horizontal waving.",
                                "id": 40,
                                "idName": "vhs_edge_wave_frequency",
                                "kind": 3,
                                "value": {
                                    "min": 0,
                                    "max": 0.5,
                                    "logarithmic": false,
                                    "defaultValue": 0.05
                                }
                            },
                            {
                                "label": "Detail",
                                "description": "Octaves of noise for the waves.",
                                "id": 41,
                                "idName": "vhs_edge_wave_detail",
                                "kind": 2,
                                "value": {
                                    "min": 1,
                                    "max": 5,
                                    "defaultValue": 2
                                }
                            }
                        ],
                        "defaultValue": true
                    }
                }
            ],
            "defaultValue": true
        }
    },
    {
        "label": "Vertically blend chroma",
        "description": "Vertically blend each scanline's chrominance with the scanline above it.",
        "id": 25,
        "idName": "vhs_chroma_vert_blend",
        "kind": 4,
        "value": {
            "defaultValue": true
        }
    },
    {
        "label": "Chroma low-pass out",
        "description": "Apply a low-pass filter to the output chroma signal.",
        "id": 10,
        "idName": "chroma_lowpass_out",
        "kind": 0,
        "value": {
            "options": [
                {
                    "label": "Full",
                    "description": "Full-intensity low-pass filter.",
                    "index": 2
                },
                {
                    "label": "Light",
                    "description": "Less intense low-pass filter.",
                    "index": 1
                },
                {
                    "label": "None",
                    "description": "No low-pass filter.",
                    "index": 0
                }
            ],
            "defaultValue": 2
        }
    },
    {
        "label": "Scale",
        "description": "Scale the effect by these factors.",
        "id": 61,
        "idName": "scale_settings",
        "kind": 5,
        "value": {
            "children": [
                {
                    "label": "Horizontal scale",
                    "description": "Horizontally scale the effect by this amount. For 480p video, leave this at 1.0 for the most physically-accurate result.",
                    "id": 32,
                    "idName": "bandwidth_scale",
                    "kind": 3,
                    "value": {
                        "min": 0.125,
                        "max": 8,
                        "logarithmic": false,
                        "defaultValue": 1
                    }
                },
                {
                    "label": "Vertical scale",
                    "description": "Vertically scale the effect by this amount. You should probably leave this at 1.0.",
                    "id": 59,
                    "idName": "vertical_scale",
                    "kind": 3,
                    "value": {
                        "min": 0.125,
                        "max": 8.8,
                        "logarithmic": false,
                        "defaultValue": 1
                    }
                },
                {
                    "label": "Scale with video size",
                    "description": "Multiply the scaling factors by the video's height. Prefer scaling the input video to 480p instead, which gives much more accurate-looking results.",
                    "id": 60,
                    "idName": "scale_with_video_size",
                    "kind": 4,
                    "value": {
                        "defaultValue": false
                    }
                }
            ],
            "defaultValue": true
        }
    }
];
export default SETTING_DESCRIPTORS;

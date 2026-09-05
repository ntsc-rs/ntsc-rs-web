use ntsc_rs::{
    NtscEffect,
    settings::{EnumValue, SettingDescriptor, SettingKind, Settings as _, SettingsList},
};
use std::fmt::Write as _;
use wasm_bindgen::prelude::*;

use crate::NtscConfigurator;

#[wasm_bindgen]
pub struct NtscSettingsList(SettingsList<NtscEffect>);

struct DescriptorList<'a> {
    descriptors: &'a [SettingDescriptor<NtscEffect>],
    default_settings: &'a NtscEffect,
    legacy_default_settings: &'a NtscEffect,
}

struct JsonStr<'a>(&'a str);
struct OptionalJsonStr<'a>(Option<&'a str>);

impl std::fmt::Display for JsonStr<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_char('"')?;

        let bytes = self.0.as_bytes();
        let mut start = 0;
        for (i, &byte) in bytes.iter().enumerate() {
            if matches!(byte, 0..=0x1f | b'"' | b'\\') {
                if start < i {
                    f.write_str(&self.0[start..i])?;
                }
                start = i + 1;

                match byte {
                    0x08 => f.write_str("\\b")?,
                    0x09 => f.write_str("\\t")?,
                    0x0a => f.write_str("\\n")?,
                    0x0c => f.write_str("\\f")?,
                    0x0d => f.write_str("\\r")?,
                    b'"' => f.write_str("\\\"")?,
                    b'\\' => f.write_str("\\\\")?,
                    _ => {
                        write!(f, "\\u{:04x}", byte)?;
                    }
                }
            }
        }

        if start < bytes.len() {
            f.write_str(&self.0[start..])?;
        }

        f.write_char('"')?;

        Ok(())
    }
}

impl std::fmt::Display for OptionalJsonStr<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.0 {
            Some(s) => JsonStr(s).fmt(f),
            None => f.write_str("null"),
        }
    }
}

#[wasm_bindgen(js_name = "DescriptorKind")]
pub enum NtscDescriptorKind {
    Enumeration,
    Percentage,
    IntRange,
    FloatRange,
    Boolean,
    Group,
}

impl std::fmt::Display for DescriptorList<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_char('[')?;
        let default_settings = self.default_settings;

        for (i, descriptor) in self.descriptors.iter().enumerate() {
            let label = JsonStr(&descriptor.label);
            let description = OptionalJsonStr(descriptor.description.as_deref());
            let id_name = JsonStr(descriptor.id.name);
            let id_num = descriptor.id.id;
            let kind = match &descriptor.kind {
                SettingKind::Enumeration { .. } => NtscDescriptorKind::Enumeration as u32,
                SettingKind::Percentage { .. } => NtscDescriptorKind::Percentage as u32,
                SettingKind::IntRange { .. } => NtscDescriptorKind::IntRange as u32,
                SettingKind::FloatRange { .. } => NtscDescriptorKind::FloatRange as u32,
                SettingKind::Boolean => NtscDescriptorKind::Boolean as u32,
                SettingKind::Group { .. } => NtscDescriptorKind::Group as u32,
            };
            write!(
                f,
                r#"{{"label":{label},"description":{description},"id":{id_num},"idName":{id_name},"kind":{kind},"value":"#
            )?;

            match &descriptor.kind {
                SettingKind::Enumeration { options } => {
                    write!(f, r#"{{"options":["#)?;
                    for (i, option) in options.iter().enumerate() {
                        let label = JsonStr(option.label);
                        let description = OptionalJsonStr(option.description);
                        let index = option.index;
                        write!(
                            f,
                            r#"{{"label":{label},"description":{description},"index":{index}}}"#
                        )?;

                        if i != options.len() - 1 {
                            f.write_char(',')?;
                        }
                    }
                    let default_value = default_settings
                        .get_field::<EnumValue>(&descriptor.id)
                        .unwrap()
                        .0;
                    write!(f, r#"],"defaultValue":{default_value}}}"#)?;
                }
                SettingKind::Percentage { logarithmic } => {
                    let default_value = default_settings.get_field::<f32>(&descriptor.id).unwrap();

                    write!(
                        f,
                        r#"{{"logarithmic":{logarithmic},"defaultValue":{default_value}}}"#
                    )?;
                }
                SettingKind::IntRange { range } => {
                    let min = *range.start();
                    let max = *range.end();
                    let default_value = default_settings.get_field::<i32>(&descriptor.id).unwrap();

                    write!(
                        f,
                        r#"{{"min":{min},"max":{max},"defaultValue":{default_value}}}"#
                    )?;
                }
                SettingKind::FloatRange { range, logarithmic } => {
                    let min = *range.start();
                    let max = *range.end();
                    let default_value = default_settings.get_field::<f32>(&descriptor.id).unwrap();

                    write!(
                        f,
                        r#"{{"min":{min},"max":{max},"logarithmic":{logarithmic},"defaultValue":{default_value}}}"#
                    )?;
                }
                SettingKind::Boolean => {
                    let default_value = default_settings.get_field::<bool>(&descriptor.id).unwrap();

                    write!(f, r#"{{"defaultValue":{default_value}}}"#)?;
                }
                SettingKind::Group { children } => {
                    let default_value = default_settings.get_field::<bool>(&descriptor.id).unwrap();

                    let children = DescriptorList {
                        descriptors: children,
                        default_settings,
                        legacy_default_settings: self.legacy_default_settings,
                    };

                    write!(
                        f,
                        r#"{{"children":{children},"defaultValue":{default_value}}}"#
                    )?;
                }
            }

            if i == self.descriptors.len() - 1 {
                // Avoid trailing comma for last element.
                write!(f, "}}")?;
            } else {
                write!(f, "}},")?;
            }
        }

        f.write_char(']')?;
        Ok(())
    }
}

#[wasm_bindgen]
impl NtscSettingsList {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self(SettingsList::<NtscEffect>::new())
    }

    #[wasm_bindgen(js_name = "getSettingsList")]
    pub fn get_settings_list(&self) -> String {
        let default_settings = NtscEffect::default();
        let legacy_default_settings = NtscEffect::legacy_value();
        let dl = DescriptorList {
            descriptors: &self.0.setting_descriptors,
            default_settings: &default_settings,
            legacy_default_settings: &legacy_default_settings,
        };
        dl.to_string()
    }

    #[wasm_bindgen(js_name = "settingsFromJSON")]
    pub fn settings_from_json(&self, json: &str) -> Result<NtscConfigurator, String> {
        Ok(NtscConfigurator(
            self.0.from_json(json).map_err(|e| e.to_string())?,
        ))
    }

    #[wasm_bindgen(js_name = "parsePreset")]
    pub fn parse_preset(&self, json: &str) -> Result<String, String> {
        Ok(self
            .0
            .to_json_string(&self.0.from_json(json).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?)
    }

    #[wasm_bindgen(js_name = "defaultPreset")]
    pub fn default_preset(&self) -> Result<String, String> {
        Ok(self
            .0
            .to_json_string(&NtscEffect::default())
            .map_err(|e| e.to_string())?)
    }
}

#[wasm_bindgen(typescript_custom_section)]
const TS_SETTINGS_LIST: &'static str = r#"

export type SettingDescriptor = {
    label: string,
    description: string | null,
    kind: DescriptorKind,
    id: number,
    idName: string,
} & SettingDescriptorKV;

export type EnumSettingDescriptor = {
    options: {label: string, description: string | null, index: number}[],
    defaultValue: number,
};

export type PercentageSettingDescriptor = {
    logarithmic: boolean,
    defaultValue: number,
};

export type IntRangeSettingDescriptor = {
    min: number,
    max: number,
    defaultValue: number,
};

export type FloatRangeSettingDescriptor = {
    min: number,
    max: number,
    logarithmic: boolean,
    defaultValue: number,
};

export type BooleanSettingDescriptor = {
    defaultValue: boolean,
};

export type GroupSettingDescriptor = {
    defaultValue: boolean,
    children: SettingDescriptor[],
};

type SettingDescriptorKV =
    | {kind: DescriptorKind.Enumeration, value: EnumSettingDescriptor}
    | {kind: DescriptorKind.Percentage, value: PercentageSettingDescriptor}
    | {kind: DescriptorKind.IntRange, value: IntRangeSettingDescriptor}
    | {kind: DescriptorKind.FloatRange, value: FloatRangeSettingDescriptor}
    | {kind: DescriptorKind.Boolean, value: BooleanSettingDescriptor}
    | {kind: DescriptorKind.Group, value: GroupSettingDescriptor};

"#;

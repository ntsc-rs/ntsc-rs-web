use ntsc_rs::{
    NtscEffectFullSettings,
    settings::{EnumValue, SettingDescriptor, SettingKind, Settings as _, SettingsList},
};
use sval_json::stream_to_string;
use wasm_bindgen::prelude::*;

use crate::NtscConfigurator;

#[wasm_bindgen]
pub struct NtscSettingsList(SettingsList<NtscEffectFullSettings>);

struct DescriptorList<'a> {
    descriptors: &'a [SettingDescriptor<NtscEffectFullSettings>],
    default_settings: &'a NtscEffectFullSettings,
    legacy_default_settings: &'a NtscEffectFullSettings,
}

trait SvalValue<'sval> {
    fn write(&self, stream: &mut impl sval::Stream<'sval>) -> sval::Result;
}

impl<'sval> SvalValue<'sval> for f32 {
    fn write(&self, stream: &mut impl sval::Stream<'sval>) -> sval::Result {
        stream.f32(*self)
    }
}

impl<'sval> SvalValue<'sval> for i32 {
    fn write(&self, stream: &mut impl sval::Stream<'sval>) -> sval::Result {
        stream.i32(*self)
    }
}

impl<'sval> SvalValue<'sval> for u32 {
    fn write(&self, stream: &mut impl sval::Stream<'sval>) -> sval::Result {
        stream.u32(*self)
    }
}

impl<'sval> SvalValue<'sval> for bool {
    fn write(&self, stream: &mut impl sval::Stream<'sval>) -> sval::Result {
        stream.bool(*self)
    }
}

impl<'sval> SvalValue<'sval> for &'sval str {
    fn write(&self, stream: &mut impl sval::Stream<'sval>) -> sval::Result {
        stream.text(self)
    }
}

impl<'sval, T: SvalValue<'sval>> SvalValue<'sval> for Option<T> {
    fn write(&self, stream: &mut impl sval::Stream<'sval>) -> sval::Result {
        match self {
            Some(v) => v.write(stream),
            None => stream.null(),
        }
    }
}

trait StreamExt<'sval> {
    fn text(&mut self, text: &'sval str) -> sval::Result;
    fn map_kv<T: SvalValue<'sval>>(&mut self, key: &'sval str, value: T) -> sval::Result;
    fn map_key(&mut self, key: &'sval str) -> sval::Result;
}

impl<'sval, T> StreamExt<'sval> for T
where
    T: sval::Stream<'sval>,
{
    fn text(&mut self, text: &'sval str) -> sval::Result {
        self.text_begin(Some(text.len()))?;
        self.text_fragment(text)?;
        self.text_end()?;
        Ok(())
    }

    fn map_kv<V: SvalValue<'sval>>(&mut self, key: &'sval str, value: V) -> sval::Result {
        self.map_key_begin()?;
        self.text(key)?;
        self.map_key_end()?;
        self.map_value_begin()?;
        value.write(self)?;
        self.map_value_end()?;
        Ok(())
    }

    fn map_key(&mut self, key: &'sval str) -> sval::Result {
        self.map_key_begin()?;
        self.text(key)?;
        self.map_key_end()?;

        Ok(())
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

impl sval::Value for DescriptorList<'_> {
    fn stream<'sval, S: sval::Stream<'sval> + ?Sized>(
        &'sval self,
        mut stream: &mut S,
    ) -> sval::Result {
        let default_settings = self.default_settings;
        stream.seq_begin(Some(self.descriptors.len()))?;

        for descriptor in self.descriptors {
            stream.seq_value_begin()?;
            stream.map_begin(None)?;

            stream.map_kv("label", descriptor.label)?;
            stream.map_kv("description", descriptor.description)?;
            stream.map_kv("id", descriptor.id.id)?;
            stream.map_kv("idName", descriptor.id.name)?;

            match &descriptor.kind {
                SettingKind::Enumeration { options, .. } => {
                    let default_value = default_settings
                        .get_field::<EnumValue>(&descriptor.id)
                        .unwrap();

                    stream.map_kv("kind", NtscDescriptorKind::Enumeration as u32)?;
                    stream.map_key("value")?;
                    stream.map_value_begin()?;

                    stream.map_begin(None)?;
                    stream.map_key("options")?;
                    stream.map_value_begin()?;
                    stream.seq_begin(Some(options.len()))?;
                    for option in options {
                        stream.seq_value_begin()?;
                        stream.map_begin(None)?;
                        stream.map_kv("label", option.label)?;
                        stream.map_kv("description", option.description)?;
                        stream.map_kv("index", option.index)?;
                        stream.map_end()?;
                        stream.seq_value_end()?;
                    }
                    stream.seq_end()?;
                    stream.map_value_end()?;
                    stream.map_kv("defaultValue", default_value.0)?;
                    stream.map_end()?;

                    stream.map_value_end()?;
                }
                SettingKind::Percentage { logarithmic, .. } => {
                    let default_value = default_settings.get_field::<f32>(&descriptor.id).unwrap();

                    stream.map_kv("kind", NtscDescriptorKind::Percentage as u32)?;
                    stream.map_key("value")?;
                    stream.map_value_begin()?;

                    stream.map_begin(None)?;
                    stream.map_kv("logarithmic", *logarithmic)?;
                    stream.map_kv("defaultValue", default_value)?;
                    stream.map_end()?;

                    stream.map_value_end()?;
                }
                SettingKind::IntRange { range, .. } => {
                    let default_value = default_settings.get_field::<i32>(&descriptor.id).unwrap();

                    stream.map_kv("kind", NtscDescriptorKind::IntRange as u32)?;
                    stream.map_key("value")?;
                    stream.map_value_begin()?;

                    stream.map_begin(None)?;
                    stream.map_kv("min", *range.start())?;
                    stream.map_kv("max", *range.end())?;
                    stream.map_kv("defaultValue", default_value)?;
                    stream.map_end()?;

                    stream.map_value_end()?;
                }
                SettingKind::FloatRange {
                    range, logarithmic, ..
                } => {
                    let default_value = default_settings.get_field::<f32>(&descriptor.id).unwrap();

                    stream.map_kv("kind", NtscDescriptorKind::FloatRange as u32)?;
                    stream.map_key("value")?;
                    stream.map_value_begin()?;

                    stream.map_begin(None)?;
                    stream.map_kv("min", *range.start())?;
                    stream.map_kv("max", *range.end())?;
                    stream.map_kv("logarithmic", *logarithmic)?;
                    stream.map_kv("defaultValue", default_value)?;
                    stream.map_end()?;

                    stream.map_value_end()?;
                }
                SettingKind::Boolean { .. } => {
                    let default_value = default_settings.get_field::<bool>(&descriptor.id).unwrap();

                    stream.map_kv("kind", NtscDescriptorKind::Boolean as u32)?;
                    stream.map_key("value")?;
                    stream.map_value_begin()?;

                    stream.map_begin(None)?;
                    stream.map_kv("defaultValue", default_value)?;
                    stream.map_end()?;

                    stream.map_value_end()?;
                }
                SettingKind::Group { children, .. } => {
                    let default_value = default_settings.get_field::<bool>(&descriptor.id).unwrap();

                    stream.map_kv("kind", NtscDescriptorKind::Group as u32)?;
                    stream.map_key("value")?;
                    stream.map_value_begin()?;

                    stream.map_begin(None)?;

                    stream.map_key("children")?;
                    let dl = DescriptorList {
                        descriptors: children,
                        default_settings: self.default_settings,
                        legacy_default_settings: self.legacy_default_settings,
                    };
                    stream.value_computed(&dl)?;

                    stream.map_kv("defaultValue", default_value)?;
                    stream.map_end()?;

                    stream.map_value_end()?;
                }
            }

            stream.map_end()?;
        }

        stream.seq_end()?;

        Ok(())
    }
}

#[wasm_bindgen]
impl NtscSettingsList {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self(SettingsList::<NtscEffectFullSettings>::new())
    }

    #[wasm_bindgen(js_name = "getSettingsList")]
    pub fn get_settings_list(&self) -> String {
        let default_settings = NtscEffectFullSettings::default();
        let legacy_default_settings = NtscEffectFullSettings::legacy_value();
        let dl = DescriptorList {
            descriptors: &self.0.setting_descriptors,
            default_settings: &default_settings,
            legacy_default_settings: &legacy_default_settings,
        };
        return stream_to_string(&dl).unwrap();
    }

    #[wasm_bindgen(js_name = "settingsFromJSON")]
    pub fn settings_from_json(&self, json: &str) -> Result<NtscConfigurator, String> {
        Ok(NtscConfigurator(
            self.0.from_json(json).map_err(|e| e.to_string())?,
        ))
    }

    #[wasm_bindgen(js_name = "parsePreset")]
    pub fn parse_preset(&self, json: &str) -> Result<String, String> {
        Ok(stream_to_string(
            self.0
                .to_json(&self.0.from_json(json).map_err(|e| e.to_string())?),
        )
        .map_err(|e| e.to_string())?)
    }

    #[wasm_bindgen(js_name = "defaultPreset")]
    pub fn default_preset(&self) -> Result<String, String> {
        Ok(
            stream_to_string(self.0.to_json(&NtscEffectFullSettings::default()))
                .map_err(|e| e.to_string())?,
        )
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

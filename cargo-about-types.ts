/**
 * TypeScript types for cargo-about JSON output.
 * Translated from Rust types (krates + cargo-about) by Claude.
 */

/** Semantic version string */
export type Version = string;

/** Opaque identifier for a package */
export type PackageId = string;

/** Rust edition (e.g., "2015", "2018", "2021") */
export type Edition = string;

export interface Source {
    kind: string;
    url: string;
}

export interface Target {
    kind: string[];
    crate_types: string[];
    name: string;
    src_path: string;
    edition: Edition;
    [key: string]: unknown;
}

export interface Dependency {
    /** Name as given in the Cargo.toml */
    name: string;
    /** The source of dependency */
    source: string | null;
    /** The required version */
    req: string;
    /** The kind of dependency this is */
    kind: 'normal' | 'dev' | 'build';
    /** Whether this dependency is required or optional */
    optional: boolean;
    /** Whether the default features in this dependency are used */
    uses_default_features: boolean;
    /** The list of features enabled for this dependency */
    features: string[];
    /** The target this dependency is specific to */
    target: string | null;
    /** If the dependency is renamed, this is the new name for the dependency */
    rename: string | null;
    /** The URL of the index of the registry where this dependency is from */
    registry: string | null;
    /** The file system path for a local path dependency */
    path: string | null;
}

export interface Package {
    /** The name field as given in the Cargo.toml */
    name: string;
    /** The version field as specified in the Cargo.toml */
    version: Version;
    /** The authors field as specified in the Cargo.toml */
    authors: string[];
    /** An opaque identifier for a package */
    id: PackageId;
    /** The source of the package, e.g. crates.io or null for local projects */
    source: Source | null;
    /** The description field as specified in the Cargo.toml */
    description: string | null;
    /** List of dependencies of this particular package */
    dependencies: Dependency[];
    /** The license field as specified in the Cargo.toml */
    license: string | null;
    /** The license-file field as specified in the Cargo.toml */
    license_file: string | null;
    /** Targets provided by the crate (lib, bin, example, test, ...) */
    targets: Target[];
    /** Features provided by the crate, mapped to the features required by that feature */
    features: Record<string, string[]>;
    /** Path containing the Cargo.toml */
    manifest_path: string;
    /** The categories field as specified in the Cargo.toml */
    categories: string[];
    /** The keywords field as specified in the Cargo.toml */
    keywords: string[];
    /** The readme field as specified in the Cargo.toml */
    readme: string | null;
    /** The repository URL as specified in the Cargo.toml */
    repository: string | null;
    /** The homepage URL as specified in the Cargo.toml */
    homepage: string | null;
    /** The documentation URL as specified in the Cargo.toml */
    documentation: string | null;
    /** The default Rust edition for the package */
    edition: Edition;
    /** Contents of the free form package.metadata section */
    metadata: unknown;
    /** The name of a native library the package is linking to */
    links: string | null;
    /** List of registries to which this package may be published */
    publish: string[] | null;
    /** The default-run field - the default binary to run by cargo run */
    default_run: string | null;
    /** The rust-version field - the minimum supported Rust version */
    rust_version: Version | null;
}

export interface UsedBy {
    /** The crate that uses this license (renamed from 'krate' in Rust) */
    crate: Package;
    /** Path to the license file, if available */
    path: string | null;
}

export interface License {
    /** The full name of the license */
    name: string;
    /** The SPDX short identifier for the license */
    id: string;
    /** True if this is the first license of its kind in the flat array */
    first_of_kind: boolean;
    /** The full license text */
    text: string;
    /** The path where the license text was sourced from */
    source_path: string | null;
    /** The list of crates this license was applied to */
    used_by: UsedBy[];
}

export interface LicenseSet {
    /** Number of packages that use this license */
    count: number;
    /** This license's human-readable name (e.g. "Apache License 2.0") */
    name: string;
    /** This license's SPDX identifier (e.g. "Apache-2.0") */
    id: string;
    /** Indices (in LicenseList.crates) of the crates that use this license */
    indices: number[];
    /** This license's text. Currently taken from the first crate that uses the license */
    text: string;
}

export interface PackageLicense {
    /** The package itself */
    package: Package;
    /** The package's license: either a SPDX license identifier, "Unknown", or "Ignore" (serialized as string) */
    license: string;
}

export interface LicenseList {
    /** All license types (e.g. Apache, MIT) and the indices (in crates) of the crates that use them */
    overview: LicenseSet[];
    /**
     * All unique license texts (which may differ by e.g. copyright string, even among licenses of the same type), and
     * the crates that use them
     */
    licenses: License[];
    /** All input packages/crates */
    crates: PackageLicense[];
}

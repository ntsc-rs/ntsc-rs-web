import style from './style.module.scss';

import {Signal, useSignal} from '@preact/signals';
import {useEffect} from 'preact/hooks';
import Modal from '../Modal/Modal';
import Loader from '../Loader/Loader';
import Icon from '../Icon/Icon';

type CreditsLicense = {
    name: string;
    version: string;
    identifier?: string;
    text?: number | {name: string; text: number}[];
};

type LicensesData = {
    js: CreditsLicense[];
    rust: CreditsLicense[];
    c: CreditsLicense[];
    texts: string[];
};

type LoadState =
    | {state: 'loading'}
    | {state: 'loaded'; data: LicensesData}
    | {state: 'error'; error: string};

const CreditsModal = ({onClose}: {onClose: () => void}) => {
    const loadState = useSignal<LoadState>({state: 'loading'});
    const expandedLicense = useSignal<string | null>(null);

    useEffect(() => {
        fetch('/licenses.json')
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json() as Promise<LicensesData>;
            })
            .then(data => {
                loadState.value = {state: 'loaded', data};
            })
            .catch(err => {
                loadState.value = {
                    state: 'error',
                    error: err instanceof Error ? err.message : String(err),
                };
            });
    }, []);

    return (
        <Modal onClose={onClose} className={style.creditsModal}>
            <h1>Credits</h1>
            <p>
                ntsc-rs is built with the following open-source libraries.
            </p>
            {loadState.value.state === 'loading' && (
                <div className={style.loading}>
                    <Loader />
                </div>
            )}
            {loadState.value.state === 'error' && (
                <p className={style.error}>
                    Could not load license information.
                </p>
            )}
            {loadState.value.state === 'loaded' && (() => {
                const {data} = loadState.value;
                return (
                    <div className={style.licenseList}>
                        {data.rust.length > 0 && (
                            <>
                                <h2>Rust dependencies</h2>
                                {data.rust.map((dep, i) => (
                                    <LicenseItem
                                        key={`rust-${i}`}
                                        dep={dep}
                                        texts={data.texts}
                                        index={`rust-${i}`}
                                        expandedLicense={expandedLicense}
                                    />
                                ))}
                            </>
                        )}
                        {data.js.length > 0 && (
                            <>
                                <h2>JavaScript dependencies</h2>
                                {data.js.map((dep, i) => (
                                    <LicenseItem
                                        key={`js-${i}`}
                                        dep={dep}
                                        texts={data.texts}
                                        index={`js-${i}`}
                                        expandedLicense={expandedLicense}
                                    />
                                ))}
                            </>
                        )}
                        {data.c.length > 0 && (
                            <>
                                <h2>C dependencies</h2>
                                {data.c.map((dep, i) => (
                                    <LicenseItem
                                        key={`c-${i}`}
                                        dep={dep}
                                        texts={data.texts}
                                        index={`c-${i}`}
                                        expandedLicense={expandedLicense}
                                    />
                                ))}
                            </>
                        )}
                    </div>
                );
            })()}
        </Modal>
    );
};

const LicenseItem = ({dep, texts, index, expandedLicense}: {
    dep: CreditsLicense;
    texts: string[];
    index: string;
    expandedLicense: Signal<string | null>;
}) => {
    const isExpanded = expandedLicense.value === index;

    const licenseNames: string[] = [];
    if (dep.identifier) {
        licenseNames.push(dep.identifier);
    } else if (typeof dep.text === 'object' && Array.isArray(dep.text)) {
        for (const entry of dep.text) {
            licenseNames.push(entry.name);
        }
    }

    const hasText = typeof dep.text === 'number' ||
        (typeof dep.text === 'object' && Array.isArray(dep.text));

    const toggle = () => {
        if (!hasText) return;
        expandedLicense.value = isExpanded ? null : index;
    };

    return (
        <div className={style.licenseItem}>
            <button
                className={style.licenseHeader}
                onClick={toggle}
                disabled={!hasText}
            >
                <Icon
                    type={isExpanded ? 'arrow-down' : 'arrow-right'}
                    title=""
                />
                <span className={style.depName}>{dep.name}</span>
                <span className={style.depVersion}>{dep.version}</span>
                {licenseNames.length > 0 && (
                    <span className={style.depLicense}>{licenseNames.join(', ')}</span>
                )}
            </button>
            {isExpanded && hasText && (
                <pre className={style.licenseText}>
                    {typeof dep.text === 'number' ?
                        texts[dep.text] :
                        Array.isArray(dep.text) ?
                            dep.text.map(entry => texts[entry.text]).join('\n\n---\n\n') :
                            ''
                    }
                </pre>
            )}
        </div>
    );
};

export default CreditsModal;

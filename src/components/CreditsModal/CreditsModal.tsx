import style from './style.module.scss';

import {Signal, useSignal} from '@preact/signals';
import {useEffect} from 'preact/hooks';
import Modal from 'valadaptive-lib/Modal';
import Loader from 'valadaptive-lib/Loader';
import Icon from 'valadaptive-lib/Icon';
import {Button} from 'valadaptive-lib/Button';

type CreditsLicense = {
    name: string;
    version: string;
    identifier?: string;
    text?: number | {name: string; text: number}[];
};

type LicenseGroup = {
    title: string,
    licenses: CreditsLicense[]
};

type LicensesData = {
    groups: LicenseGroup[],
    texts: string[];
};

type LoadState =
    | {state: 'not-loaded'}
    | {state: 'loading'}
    | {state: 'loaded'; data: LicensesData}
    | {state: 'error'; error: string};

const CreditsModal = ({onClose}: {onClose: () => void}) => {
    const loadState = useSignal<LoadState>({state: 'not-loaded'});
    const expandedLicense = useSignal<string | null>(null);

    useEffect(() => {
        if (loadState.value.state !== 'not-loaded') {
            return;
        }
        loadState.value = {state: 'loading'};
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
        <Modal
            onClose={onClose}
            className={style.creditsModal}
            title="Credits"
        >
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
                        {data.groups.map(({title, licenses}, i) => (
                            <>
                                <h2>{title}</h2>
                                {licenses.map((dep, j) => (
                                    <LicenseItem
                                        key={`${i}-${j}`}
                                        dep={dep}
                                        texts={data.texts}
                                        index={`${i}-${j}`}
                                        expandedLicense={expandedLicense}
                                    />
                                ))}
                            </>
                        ))}
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
            <Button
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
            </Button>
            {isExpanded && hasText && (
                (typeof dep.text === 'number' ?
                    <pre className={style.licenseText}>
                        {texts[dep.text]}
                    </pre> :
                    dep.text!.map((entry, i) =>
                        <pre className={style.licenseText} key={i}>
                            {texts[entry.text]}
                        </pre>,
                    )
                )
            )}
        </div>
    );
};

export default CreditsModal;

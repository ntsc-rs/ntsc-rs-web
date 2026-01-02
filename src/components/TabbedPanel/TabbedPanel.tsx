import style from './style.module.scss';

import type {ComponentChild} from 'preact';
import {useSignal, useComputed} from '@preact/signals';
import classNames from 'clsx';

type Tab = {
    id: string,
    panel: ComponentChild | (() => ComponentChild) | null,
    title: ComponentChild,
    disabled?: boolean
};

type TabbedPanelProps<T extends readonly Tab[]> = {
    tabs: T,
    initialTab: T[number]['id'] | null,
    alignment?: 'start' | 'end',
    className?: string,
};

const TabbedPanel = <T extends readonly Tab[]>({tabs, initialTab, alignment, className}: TabbedPanelProps<T>) => {
    const activeTabID = useSignal(initialTab);

    const tabsByID = useComputed(() => {
        const tabsRecord: Record<string, Tab> = {};
        for (const tab of tabs) {
            tabsRecord[tab.id] = tab;
        }
        return tabsRecord;
    });

    const activeTab = activeTabID.value ? tabsByID.value[activeTabID.value] : null;
    const tabPanel = activeTab?.panel;

    return (
        <div className={classNames(className, style.tabbedPanel)}>
            <div className={classNames({
                [style.tabs]: true,
                [style.alignStart]: alignment === 'start',
                [style.alignEnd]: alignment === 'end',
            })}>
                {tabs.map(tab => (
                    <div
                        key={tab.id}
                        className={classNames({
                            [style.tab]: true,
                            [style.activeTab]: activeTabID.value === tab.id,
                            [style.disabled]: tabPanel === null || tab.disabled,
                        })}
                        onClick={() => {
                            if (tab.panel === null || tab.disabled) return;
                            activeTabID.value = tab.id;
                        }}
                    >
                        {tab.title}
                    </div>
                ))}
            </div>
            <div className={style.panel}>
                {typeof tabPanel === 'function' ? tabPanel() : tabPanel}
            </div>
        </div>
    );
};

export default TabbedPanel;

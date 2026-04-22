import clsx from 'clsx';
import React, {useEffect, useState} from 'react';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {useLocation} from '@docusaurus/router';
import {useDocsSidebar} from '@docusaurus/plugin-content-docs/client';
import DocSidebarItems from '@theme/DocSidebarItems';

import styles from './MobileDocsSidebar.module.css';

export default function MobileDocsSidebar() {
  const sidebar = useDocsSidebar();
  const {pathname} = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  if (!sidebar) {
    return null;
  }

  return (
    <section className={styles.mobileDocsSidebar} aria-label="Docs navigation">
      <button
        type="button"
        className={clsx('clean-btn', styles.mobileDocsSidebarToggle)}
        aria-expanded={isOpen}
        aria-controls="mobile-docs-sidebar-panel"
        onClick={() => {
          setIsOpen((currentValue) => !currentValue);
        }}>
        <span className={styles.mobileDocsSidebarToggleLabel}>
          <span className={styles.mobileDocsSidebarToggleHint}>Docs</span>
          <span className={styles.mobileDocsSidebarToggleText}>
            Browse sections
          </span>
        </span>
        <span
          aria-hidden="true"
          className={clsx(
            styles.mobileDocsSidebarToggleIcon,
            isOpen && styles.mobileDocsSidebarToggleIconOpen,
          )}>
          v
        </span>
      </button>
      {isOpen && (
        <nav
          id="mobile-docs-sidebar-panel"
          className={styles.mobileDocsSidebarPanel}
          aria-label="Docs sections">
          <ul
            className={clsx(
              'menu',
              'thin-scrollbar',
              'menu__list',
              ThemeClassNames.docs.docSidebarMenu,
              styles.mobileDocsSidebarMenu,
            )}>
            <DocSidebarItems
              items={sidebar.items}
              activePath={pathname}
              level={1}
              onItemClick={(item) => {
                if (item.type === 'link') {
                  setIsOpen(false);
                }
                if (item.type === 'category' && item.href) {
                  setIsOpen(false);
                }
              }}
            />
          </ul>
        </nav>
      )}
    </section>
  );
}

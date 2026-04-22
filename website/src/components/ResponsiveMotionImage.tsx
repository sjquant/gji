import clsx from 'clsx';
import React from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

import styles from './ResponsiveMotionImage.module.css';

type ResponsiveMotionImageProps = {
  alt: string;
  animatedSrc: string;
  height: number;
  staticSrc: string;
  width: number;
};

export default function ResponsiveMotionImage({
  alt,
  animatedSrc,
  height,
  staticSrc,
  width,
}: ResponsiveMotionImageProps) {
  const animatedImageSrc = useBaseUrl(animatedSrc);
  const staticImageSrc = useBaseUrl(staticSrc);

  return (
    <picture className={styles.motionImagePicture}>
      <source
        media="(prefers-reduced-motion: reduce)"
        srcSet={staticImageSrc}
      />
      <img
        className={clsx(styles.motionImageAsset)}
        src={animatedImageSrc}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        decoding="async"
      />
    </picture>
  );
}

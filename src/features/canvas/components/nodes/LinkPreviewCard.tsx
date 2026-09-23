/**
 * LinkPreviewCard - Rich link preview card component
 * Renders Open Graph / Twitter Card metadata as a clickable preview
 * All images are proxied through Cloud Functions for privacy
 * View-only: zero business logic (MVVM)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { strings } from '@/shared/localization/strings';
import { useSignedImageUrl } from '../../hooks/useSignedImageUrl';
import type { LinkPreviewMetadata } from '../../types/node';
import styles from './LinkPreviewCard.module.css';

interface LinkPreviewCardProps {
    preview: LinkPreviewMetadata;
    onRemove?: (url: string) => void;
}

/** Single link preview card with optional remove button */
export const LinkPreviewCard = React.memo(({ preview, onRemove }: LinkPreviewCardProps) => {
    const { url, title, description, image, favicon, domain, error } = preview;
    const displayTitle = title ?? domain ?? url;
    const ariaLabel = `${strings.linkPreview.openLink}: ${displayTitle}`;
    const [imageError, setImageError] = useState(false);

    const handleImageError = useCallback(() => { setImageError(true); }, []);

    const proxiedImage = useSignedImageUrl(image);
    useEffect(() => { setImageError(false); }, [proxiedImage]);
    const proxiedFavicon = useSignedImageUrl(favicon);

    if (error) {
        return (
            <div className={styles.card}>
                <a href={url} target="_blank" rel="noopener noreferrer"
                    className={styles.body} aria-label={ariaLabel}>
                    {domain && (
                        <span className={styles.domainRow}>
                            <span className={styles.domain}>{domain}</span>
                        </span>
                    )}
                    <span className={styles.errorText}>
                        {strings.linkPreview.unavailable}
                    </span>
                </a>
                {onRemove && (
                    <RemoveButton url={url} onRemove={onRemove} />
                )}
            </div>
        );
    }

    return (
        <div className={styles.card}>
            <a href={url} target="_blank" rel="noopener noreferrer"
                aria-label={ariaLabel}
                className={styles.cardLink}>
                {proxiedImage && !imageError && (
                    <div className={styles.imageWrapper}>
                        <img src={proxiedImage} alt={displayTitle}
                            className={styles.image} loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={handleImageError} />
                    </div>
                )}
                {proxiedImage && imageError && (
                    <div className={styles.imagePlaceholder}
                        role="img" aria-label={displayTitle}>
                        {strings.linkPreview.imageFailed}
                    </div>
                )}
                <div className={styles.body}>
                    <span className={styles.domainRow}>
                        {proxiedFavicon && (
                            <img src={proxiedFavicon}
                                alt={`${domain ?? ''} favicon`}
                                className={styles.favicon}
                                referrerPolicy="no-referrer" />
                        )}
                        {domain && <span className={styles.domain}>{domain}</span>}
                    </span>
                    <span className={styles.title}>{displayTitle}</span>
                    {description && (
                        <span className={styles.description}>{description}</span>
                    )}
                </div>
            </a>
            {onRemove && (
                <RemoveButton url={url} onRemove={onRemove} />
            )}
        </div>
    );
});

/** Remove button extracted to avoid duplication (DRY) */
const RemoveButton = React.memo(({ url, onRemove }: {
    url: string;
    onRemove: (url: string) => void;
}) => (
    <button className={styles.removeButton}
        aria-label={strings.linkPreview.removePreview}
        onClick={(e) => { e.preventDefault(); onRemove(url); }}>
        ✕
    </button>
));

interface LinkPreviewListProps {
    previews: Record<string, LinkPreviewMetadata>;
    onRemove?: (url: string) => void;
}

/** Only render previews whose URL starts with http:// or https:// */
function isValidPreviewUrl(url: string): boolean {
    return url.startsWith('http://') || url.startsWith('https://');
}

/** Renders a list of link preview cards from a previews record */
export const LinkPreviewList = React.memo(({ previews, onRemove }: LinkPreviewListProps) => {
    const entries = Object.values(previews).filter((p) => isValidPreviewUrl(p.url));
    if (entries.length === 0) return null;

    return (
        <div className={styles.previewList} data-testid="link-preview-list">
            {entries.map((preview) => (
                <LinkPreviewCard key={preview.url} preview={preview} onRemove={onRemove} />
            ))}
        </div>
    );
});

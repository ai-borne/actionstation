/**
 * LandingJsonLd — renders the landing page's structured data as JSON-LD scripts.
 */
import { buildLandingJsonLd } from '../services/landingJsonLd';

const JSON_LD = buildLandingJsonLd();

/** One `application/ld+json` script per schema.org object. */
export function LandingJsonLd() {
    return (
        <>
            {JSON_LD.map((data) => (
                <script key={data['@type']} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
            ))}
        </>
    );
}

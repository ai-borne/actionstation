/**
 * Paginated Firestore collection reads — fetches all docs beyond FIRESTORE_QUERY_CAP.
 */
import {
    getDocs,
    query,
    limit,
    orderBy,
    startAfter,
    type CollectionReference,
    type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { FIRESTORE_QUERY_CAP } from '@/config/firestoreQueryConfig';

/** Load every document in a collection using cursor pagination on __name__. */
export async function fetchAllCollectionDocs(
    collectionRef: CollectionReference,
): Promise<readonly QueryDocumentSnapshot[]> {
    const docs: QueryDocumentSnapshot[] = [];
    let lastDoc: QueryDocumentSnapshot | undefined;

    for (;;) {
        const q = lastDoc
            ? query(collectionRef, orderBy('__name__'), startAfter(lastDoc), limit(FIRESTORE_QUERY_CAP))
            : query(collectionRef, orderBy('__name__'), limit(FIRESTORE_QUERY_CAP));
        const snapshot = await getDocs(q);
        const pageSize = snapshot.docs.length;
        if (pageSize === 0) break;
        docs.push(...snapshot.docs);
        if (pageSize < FIRESTORE_QUERY_CAP) break;
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
    }

    return docs;
}

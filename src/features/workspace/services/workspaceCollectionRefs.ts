/** Firestore subcollection path helpers for workspace node/edge data. */
import { doc, collection } from 'firebase/firestore';
import { db } from '@/config/firebase';

export const getSubcollectionRef = (userId: string, workspaceId: string, sub: string) =>
    collection(db, 'users', userId, 'workspaces', workspaceId, sub);

export const getSubcollectionDocRef = (userId: string, workspaceId: string, sub: string, docId: string) =>
    doc(db, 'users', userId, 'workspaces', workspaceId, sub, docId);

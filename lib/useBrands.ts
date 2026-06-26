'use client';

import { useState, useEffect } from 'react';
import { db } from './firebase';
import { doc, getDoc } from 'firebase/firestore';
import { BrandDoc, UserProfile } from './types';
import { logger } from './logger';

export function useBrands(profile: UserProfile | null) {
  const [brands, setBrands] = useState<BrandDoc[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile && profile.brands && profile.brands.length > 0) {
      setLoading(true);
      setError(null);

      const fetchAllBrands = async () => {
        try {
          const brandPromises = profile.brands.map(async (bid) => {
            const brandDocRef = doc(db, 'agencies', profile.agencyId, 'brands', bid);
            const docSnap = await getDoc(brandDocRef);
            if (docSnap.exists()) {
              return { slug: bid, ...docSnap.data() } as BrandDoc;
            }
            return null;
          });

          const resolvedBrands = await Promise.all(brandPromises);
          const brandDocs = resolvedBrands.filter((b): b is BrandDoc => b !== null);

          setBrands(brandDocs);
          if (brandDocs.length > 0 && !selectedBrandId) {
            setSelectedBrandId(brandDocs[0].slug);
          }
        } catch (err: any) {
          logger.error('useBrands', err);
          setError('Failed to fetch brand permissions.');
        } finally {
          setLoading(false);
        }
      };

      fetchAllBrands();
    } else {
      setBrands([]);
      setSelectedBrandId(null);
    }
  }, [profile]);

  return {
    brands,
    selectedBrandId,
    setSelectedBrandId,
    loading,
    error,
  };
}

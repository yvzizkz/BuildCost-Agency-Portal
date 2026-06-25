'use client';

import { BrandDoc } from '@/lib/types';

interface BrandPickerProps {
  brands: BrandDoc[];
  selectedBrandId: string | null;
  onChange: (brandId: string) => void;
}

export default function BrandPicker({ brands, selectedBrandId, onChange }: BrandPickerProps) {
  if (brands.length === 0) {
    return <div className="brand-picker-empty">No brands assigned to your account.</div>;
  }

  return (
    <div className="brand-picker-container">
      <label htmlFor="brand-select" className="brand-picker-label">Active Brand</label>
      <div className="select-wrapper">
        <select
          id="brand-select"
          value={selectedBrandId || ''}
          onChange={(e) => onChange(e.target.value)}
          className="brand-picker-select"
        >
          <option value="" disabled>Select a brand...</option>
          {brands.map((brand) => (
            <option key={brand.slug} value={brand.slug}>
              {brand.displayName}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

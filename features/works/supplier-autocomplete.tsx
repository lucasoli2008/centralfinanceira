"use client";

import * as React from "react";
import { Input } from "@/components/ui/field";

interface SupplierAutocompleteProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  suppliers: string[];
  placeholder?: string;
}

/** Autocomplete simples de fornecedor/prestador, sem componente novo — input nativo + datalist. */
export function SupplierAutocomplete({
  id,
  value,
  onChange,
  onBlur,
  suppliers,
  placeholder,
}: SupplierAutocompleteProps) {
  const listId = `${id}-list`;

  return (
    <>
      <Input
        id={id}
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete="off"
      />
      <datalist id={listId}>
        {suppliers.map((supplier) => (
          <option key={supplier} value={supplier} />
        ))}
      </datalist>
    </>
  );
}

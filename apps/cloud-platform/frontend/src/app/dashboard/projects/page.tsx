'use client';

import React from 'react';
import { Card } from '@/components/ui/card';

export default function ProjectsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Proyectos</h1>
      </div>
      
      <Card>
        <p className="text-gray-500 text-center py-8">
          Gestión de proyectos - Próximamente
        </p>
      </Card>
    </div>
  );
}
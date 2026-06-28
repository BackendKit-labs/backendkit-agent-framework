'use client';

import React from 'react';
import { Card } from '@/components/ui/card';

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card title="Total de Agentes" description="Agentes registrados en el sistema">
          <p className="text-3xl font-bold text-primary-600">0</p>
        </Card>
        
        <Card title="Agentes Activos" description="Agentes en ejecución">
          <p className="text-3xl font-bold text-green-600">0</p>
        </Card>
        
        <Card title="Total de Proyectos" description="Proyectos creados">
          <p className="text-3xl font-bold text-blue-600">0</p>
        </Card>
      </div>
    </div>
  );
}
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { DirectorMetrics } from '@/lib/types';
import { MetricCard } from '@/components/ui/metric-card';
import { Activity, Users, FolderOpen, TrendingUp, Loader2, AlertCircle } from 'lucide-react';

interface DashboardMetrics {
  totalDeployables: number;
  activeDeployables: number;
  totalDepartments: number;
  uptime?: number;
  memoryUsage?: number;
  cpuUsage?: number;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const directorData = await api.get<DirectorMetrics>('/director/metrics');

      setMetrics({
        totalDeployables: directorData.totalDeployables ?? 0,
        activeDeployables: directorData.activeDeployables ?? 0,
        totalDepartments: directorData.totalDepartments ?? 0,
        uptime: directorData.uptime,
        memoryUsage: directorData.memoryUsageMb,
        // El backend no expone uso de CPU; cpuUsage queda indefinido y su tarjeta se oculta.
        cpuUsage: undefined,
      });
    } catch (err) {
      console.error('Error fetching dashboard metrics:', err);
      setError('Error al cargar las métricas del dashboard. Intente nuevamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const formatUptime = (seconds?: number): string => {
    if (!seconds) return 'N/A';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    return parts.join(' ') || '< 1m';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
          <p className="text-gray-500 text-sm">Cargando métricas del dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <AlertCircle className="h-12 w-12 text-red-500" />
          <h2 className="text-xl font-semibold text-gray-800">Error al cargar</h2>
          <p className="text-gray-500">{error}</p>
          <button
            onClick={fetchMetrics}
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          Dashboard
        </h1>
        <p className="mt-2 text-gray-500">
          Bienvenido{user?.name ? `, ${user.name}` : ''}. Resumen general del sistema Agent-Cloud.
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <MetricCard
          title="Total de Deployables"
          value={metrics?.totalDeployables ?? 0}
          icon={<Users className="h-6 w-6 text-blue-600" />}
          description="Agentes y apps registrados"
        />
        <MetricCard
          title="Deployables Activos"
          value={metrics?.activeDeployables ?? 0}
          icon={<Activity className="h-6 w-6 text-green-600" />}
          description="Actualmente en ejecución"
        />
        <MetricCard
          title="Departamentos"
          value={metrics?.totalDepartments ?? 0}
          icon={<FolderOpen className="h-6 w-6 text-purple-600" />}
          description="Unidades organizativas"
        />
      </div>

      {/* System Health Section */}
      {(metrics?.uptime !== undefined || metrics?.memoryUsage !== undefined || metrics?.cpuUsage !== undefined) && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-6">
            <TrendingUp className="h-5 w-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Estado del Sistema</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {metrics.uptime !== undefined && (
              <div className="flex flex-col items-center p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-500 mb-1">Tiempo de actividad</span>
                <span className="text-2xl font-bold text-gray-900">{formatUptime(metrics.uptime)}</span>
              </div>
            )}
            {metrics.memoryUsage !== undefined && (
              <div className="flex flex-col items-center p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-500 mb-1">Uso de memoria</span>
                <span className="text-2xl font-bold text-gray-900">{metrics.memoryUsage} MB</span>
              </div>
            )}
            {metrics.cpuUsage !== undefined && (
              <div className="flex flex-col items-center p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-500 mb-1">Uso de CPU</span>
                <span className="text-2xl font-bold text-gray-900">{metrics.cpuUsage}%</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Acciones rápidas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <a
            href="/dashboard/departments"
            className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all group"
          >
            <FolderOpen className="h-8 w-8 text-blue-600 group-hover:scale-110 transition-transform" />
            <div>
              <p className="font-medium text-gray-900">Gestionar Departamentos</p>
              <p className="text-sm text-gray-500">Crear departamentos y configurar secrets</p>
            </div>
          </a>
          <a
            href="/dashboard/deployables"
            className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:border-green-300 hover:bg-green-50 transition-all group"
          >
            <Users className="h-8 w-8 text-green-600 group-hover:scale-110 transition-transform" />
            <div>
              <p className="font-medium text-gray-900">Gestionar Deployables</p>
              <p className="text-sm text-gray-500">Configurar y desplegar agentes y apps</p>
            </div>
          </a>
          <a
            href="/dashboard/director"
            className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-all group"
          >
            <Activity className="h-8 w-8 text-purple-600 group-hover:scale-110 transition-transform" />
            <div>
              <p className="font-medium text-gray-900">Panel del Director</p>
              <p className="text-sm text-gray-500">Desplegar y controlar agentes</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
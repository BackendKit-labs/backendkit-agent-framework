import { ReactNode } from 'react';
interface MetricCardProps {
    title: string;
    value: string | number;
    icon?: ReactNode;
    description?: string;
    trend?: {
        value: number;
        isPositive: boolean;
    };
    isLoading?: boolean;
    className?: string;
}
export declare function MetricCard({ title, value, icon, description, trend, isLoading, className, }: MetricCardProps): any;
export {};

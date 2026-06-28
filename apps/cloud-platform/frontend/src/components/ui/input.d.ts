import React from 'react';
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
}
export declare function Input({ label, error, className, id, ...props }: InputProps): any;
export {};

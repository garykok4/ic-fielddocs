"use client";
import {useEffect,useState} from 'react';
import {requireActiveStaff} from '../../lib/auth';
import ProjectPhotos from '../../components/ProjectPhotos';
export default function PhotosPage(){const [ready,setReady]=useState(false),[error,setError]=useState('');useEffect(()=>{void requireActiveStaff().then(p=>setReady(!!p)).catch(e=>setError(e.message));},[]);return <main style={{padding:24}}>{error?<p role="alert">{error}</p>:ready?<ProjectPhotos/>:<p>Loading photo feed…</p>}</main>;}

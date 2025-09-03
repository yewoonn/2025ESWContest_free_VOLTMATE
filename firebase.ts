// firebase.ts
import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
    apiKey: "AIzaSyB6Jg8OpzAEARWS60O38E5YSr9XpRW0VrA",
    authDomain: "voltmate-a91ab.firebaseapp.com",
    databaseURL: "https://voltmate-a91ab-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "voltmate-a91ab",
    storageBucket: "voltmate-a91ab.appspot.com",
    messagingSenderId: "585241714908",
    appId: "1:585241714908:android:a70f8d09c6cdd9b7bf9419"
};

const app = initializeApp(firebaseConfig);

export const db = getDatabase(app);

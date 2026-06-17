import { useRouter } from 'expo-router';
import LottieView from 'lottie-react-native';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles } from '../styles/index.styles';


export default function NotFound() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      
      <View style={styles.titleContainer}>
        <LottieView
          style={styles.lottie}
          source={require('../assets/lottie/notFound.json')}
          autoPlay
          loop
          
        />
      <Text style={{ alignSelf:'center', fontSize:25, }}>Oops! Page not found.</Text>
    <View style={styles.buttonContainer}>
      <Pressable style={styles.buttonSignup} onPress={() => router.replace('/')}>
        <Text style={styles.textSignup}>Home</Text>
      </Pressable>
      </View>
      </View>
    </SafeAreaView>
  );
}

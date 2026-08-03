import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

/** Splash/auth bootstrap placeholder while root layout decides route */
export default function Index() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.blue600} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.blue50,
  },
});
